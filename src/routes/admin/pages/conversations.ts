import type { PrismaClient } from '@prisma/client'
import { layout } from '../layout.js'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

interface SessionRow {
  userId: string
  sessionId: string
  messageCount: number
  firstAt: Date
  lastAt: Date
}

async function loadSessions(
  prisma: PrismaClient,
  userId: string | undefined,
  limit: number,
  offset: number,
): Promise<SessionRow[]> {
  if (userId) {
    return prisma.$queryRaw<SessionRow[]>`
      SELECT
        user_id          AS "userId",
        session_id       AS "sessionId",
        COUNT(*)::int    AS "messageCount",
        MIN(created_at)  AS "firstAt",
        MAX(created_at)  AS "lastAt"
      FROM conversations
      WHERE user_id = ${userId}::uuid
      GROUP BY user_id, session_id
      ORDER BY MAX(created_at) DESC
      LIMIT ${limit} OFFSET ${offset}
    `
  }
  return prisma.$queryRaw<SessionRow[]>`
    SELECT
      user_id          AS "userId",
      session_id       AS "sessionId",
      COUNT(*)::int    AS "messageCount",
      MIN(created_at)  AS "firstAt",
      MAX(created_at)  AS "lastAt"
    FROM conversations
    GROUP BY user_id, session_id
    ORDER BY MAX(created_at) DESC
    LIMIT ${limit} OFFSET ${offset}
  `
}

export async function conversationsPage(
  prisma: PrismaClient,
  query: Record<string, string>,
): Promise<string> {
  const page            = Math.max(1, parseInt(query['page'] ?? '1', 10))
  const limit           = 20
  const offset          = (page - 1) * limit
  const userId          = query['userId']?.trim() || undefined
  const selectedSession = query['session']?.trim() || undefined

  const sessions = await loadSessions(prisma, userId, limit, offset)

  // If a session is selected, load its messages
  let messages: { role: string; content: string; createdAt: Date; modelUsed: string | null }[] = []
  if (selectedSession) {
    messages = await prisma.conversation.findMany({
      where: { sessionId: selectedSession },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true, createdAt: true, modelUsed: true },
    })
  }

  const sessionRows = sessions.map(s => `
    <tr class="${selectedSession === s.sessionId ? 'selected-row' : ''}">
      <td><code>${esc(s.userId.slice(0, 8))}…</code></td>
      <td>${s.messageCount}</td>
      <td>${s.firstAt.toISOString().slice(0, 16).replace('T', ' ')}</td>
      <td>${s.lastAt.toISOString().slice(0, 16).replace('T', ' ')}</td>
      <td>
        <a href="/admin/conversations?session=${esc(s.sessionId)}${userId ? `&userId=${esc(userId)}` : ''}" class="btn-sm">View</a>
      </td>
    </tr>`).join('')

  const messageHtml = selectedSession && messages.length > 0 ? `
    <h2>Session messages</h2>
    <div class="conversation-thread">
      ${messages.map(m => `
        <div class="message message-${esc(m.role)}">
          <div class="message-meta">${esc(m.role)} · ${m.createdAt.toISOString().slice(11, 19)}${m.modelUsed ? ` · ${esc(m.modelUsed)}` : ''}</div>
          <div class="message-body">${esc(m.content)}</div>
        </div>`).join('')}
    </div>` : ''

  const paginationHtml = `
    <div class="pagination">
      ${page > 1 ? `<a href="/admin/conversations?page=${page - 1}${userId ? `&userId=${esc(userId)}` : ''}" class="btn-sm">← Prev</a>` : ''}
      <span>Page ${page}</span>
      ${sessions.length === limit ? `<a href="/admin/conversations?page=${page + 1}${userId ? `&userId=${esc(userId)}` : ''}" class="btn-sm">Next →</a>` : ''}
    </div>`

  const content = `
    <h1>Conversations</h1>

    <form method="get" action="/admin/conversations" style="margin-bottom:1rem">
      <input type="text" name="userId" placeholder="Filter by user UUID" value="${userId ? esc(userId) : ''}" style="width:320px;padding:6px">
      <button type="submit" class="btn-sm">Filter</button>
      ${userId ? `<a href="/admin/conversations" class="btn-sm">Clear</a>` : ''}
    </form>

    <table class="data-table">
      <thead>
        <tr><th>User</th><th>Messages</th><th>Started</th><th>Last</th><th></th></tr>
      </thead>
      <tbody>${sessionRows || '<tr><td colspan="5" class="muted">No conversations yet</td></tr>'}</tbody>
    </table>

    ${paginationHtml}
    ${messageHtml}

    <style>
      .selected-row { background: #f0f4ff; }
      .conversation-thread { margin-top:1rem; display:flex; flex-direction:column; gap:0.75rem; max-width:720px; }
      .message { padding:0.75rem 1rem; border-radius:8px; }
      .message-user { background:#e8f0fe; }
      .message-assistant { background:#f1f3f4; }
      .message-meta { font-size:0.75rem; color:#666; margin-bottom:0.25rem; }
      .message-body { white-space:pre-wrap; word-break:break-word; }
    </style>
  `

  return layout('Conversations', content)
}

import { describe, it, expect } from 'vitest'
import { TrueLayerProvider } from '../providers/truelayer.js'

// Access the private mapTransaction via a tiny subclass for unit testing.
class TestProvider extends TrueLayerProvider {
  map(t: Record<string, unknown>, status: 'settled' | 'pending' = 'settled') {
    // @ts-expect-error — exercising the private mapper directly
    return this.mapTransaction(t, status)
  }
}

const provider = new TestProvider('cid', 'secret', 'https://app/cb', 'sandbox')

function tx(over: Record<string, unknown> = {}) {
  return {
    transaction_id: 't1',
    timestamp: '2026-11-10T10:00:00Z',
    description: 'PURCHASE',
    amount: -20,
    currency: 'GBP',
    transaction_type: 'DEBIT',
    ...over,
  }
}

describe('TrueLayer mapTransaction — transfer/refund/pending', () => {
  it('flags TRANSFER category as internal transfer', () => {
    const r = provider.map(tx({ transaction_category: 'TRANSFER' }))
    expect(r.isInternalTransfer).toBe(true)
  })

  it('flags "transfer to savings" wording as internal transfer', () => {
    const r = provider.map(tx({ description: 'TRANSFER TO SAVINGS' }))
    expect(r.isInternalTransfer).toBe(true)
  })

  it('does not flag an ordinary purchase as transfer', () => {
    const r = provider.map(tx({ description: 'TESCO STORES', transaction_category: 'PURCHASE' }))
    expect(r.isInternalTransfer).toBe(false)
  })

  it('flags a merchant refund credit as refund, not salary', () => {
    const r = provider.map(tx({ amount: 15, transaction_type: 'CREDIT', description: 'AMAZON REFUND' }))
    expect(r.isRefund).toBe(true)
    expect(r.isSalary).toBe(false)
  })

  it('does not flag salary as refund', () => {
    const r = provider.map(tx({ amount: 2000, transaction_type: 'CREDIT', transaction_category: 'SALARY', description: 'ACME PAYROLL' }))
    expect(r.isRefund).toBe(false)
    expect(r.isSalary).toBe(true)
  })

  it('sets status from the status argument (pending)', () => {
    expect(provider.map(tx(), 'pending').status).toBe('pending')
    expect(provider.map(tx(), 'settled').status).toBe('settled')
  })
})

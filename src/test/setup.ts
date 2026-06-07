import { config as dotenvConfig } from 'dotenv'

dotenvConfig({ path: '.env.test', override: false })

process.env['NODE_ENV'] ??= 'test'
process.env['DATABASE_URL'] ??= 'postgresql://monika:monika@localhost:5432/monika_test'
process.env['SECRET_KEY'] ??= 'test-secret-key-must-be-at-least-32-characters-long'
process.env['ENCRYPTION_KEY'] ??= 'a'.repeat(64)
process.env['WHATSAPP_VERIFY_TOKEN'] ??= 'test-verify-token'
process.env['WHATSAPP_APP_SECRET'] ??= 'test-app-secret'
process.env['WHATSAPP_PHONE_NUMBER_ID'] ??= 'test-phone-number-id'
process.env['WHATSAPP_ACCESS_TOKEN'] ??= 'test-access-token'
process.env['LOG_LEVEL'] ??= 'fatal'
process.env['ADMIN_USERNAME'] ??= 'testadmin'
process.env['ADMIN_PASSWORD'] ??= 'testpassword1'

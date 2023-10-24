const axios = require('axios').default
const {
    default: Baileys,
    DisconnectReason,
    fetchLatestBaileysVersion,
    useMultiFileAuthState
} = require('@whiskeysockets/baileys')
const P = require('pino')
const { translate } = require('bing-translate-api')
const { imageSync } = require('qr-image')
const { schedule } = require('node-cron')
const { Boom } = require('@hapi/boom')
const app = require('express')()
const fs = require('fs-extra')
const chalk = require('chalk')
const port = 3000

const config = {
    name: 'TG-WhatsApp',
    group: '120363024705741799@g.us',
    channels: [
        'hezbollah',
        'hamasps',
        'almayadeen',
        'nahermedia',
        'sepah_pasdaran',
        'maymun5',
        'irivf',
        'saudinews50',
        'alarabytelevision'
    ]
}

const Translate = async (text) => {
    let translation = ''
    const maxChunkSize = 1000
    for (let i = 0; i < text.length; i += maxChunkSize) {
        const chunk = text.slice(i, i + maxChunkSize)
        const result = await translate(chunk, null, 'he').catch((err) => ({ translation: err.message }))
        translation += result.translation
    }
    return translation
}

const store = new Object()

const fetch = async (username) => (await axios.get(`https://weeb-api.vercel.app/telegram/${username}`)).data

const start = async () => {
    const { state, saveCreds } = await useMultiFileAuthState('session')
    const client = Baileys({
        version: (await fetchLatestBaileysVersion()).version,
        printQRInTerminal: true,
        auth: state,
        logger: P({ level: 'fatal' }),
        browser: ['TG-WhatsApp', 'fatal', '1.0.0']
    })

    client.log = (text, error = false) =>
        console.log(chalk[error ? 'red' : 'blue'](config.name), chalk[error ? 'redBright' : 'greenBright'](text))

    client.ev.on('connection.update', async (update) => {
        if (update.qr) {
            client.log(`QR code generated. Scan it to continue | You can also authenicate in http://localhost:${port}`)
            client.QR = imageSync(update.qr)
        }
        const { connection, lastDisconnect } = update
        if (connection === 'close') {
            const { statusCode } = new Boom(lastDisconnect?.error).output
            if (statusCode !== DisconnectReason.loggedOut) {
                client.log('Reconnecting...')
                setTimeout(() => start(), 3000)
            } else {
                client.log('Disconnected.', true)
                await fs.remove('session')
                client.log('Starting...')
                setTimeout(() => start(), 3000)
            }
        }
        if (connection === 'connecting') client.log('Connecting to WhatsApp...')
        if (connection === 'open') {
            client.log('Connected to WhatsApp')
            schedule('*/1 * * * *', fetchChannels)
        }
    })

    client.ev.on('messages.upsert', async ({ messages }) => {
        const M = messages[0]
        M.from = M.key.remoteJid || ''
        const content = M.message?.conversation || ''
        if (content.startsWith('/id')) return void reply(M.from)
    })
    
    const reply = async (content, type = 'text', caption) => {
        client.log(`wa_message: ${type}`)
        if (type === 'text' && Buffer.isBuffer(content)) throw new Error('Cannot send a Buffer as a text message')
        return client.sendMessage(config.group, {
            [type]: content,
            caption
        })
    }

    const fetchChannels = async () => {
        const promises = config.channels.map(async (channel) => {
            client.log(`Checking... ${chalk.yellowBright(channel)}`)
            const messages = await fetch(channel)
            if (!messages.length) {
                config.channels = config.channels.filter((name) => name !== channel)
                client.log(`Invalid ${channel} removed`, true)
                return void null
            }
            const previousId = store[channel] || 0
            const index = messages.findIndex((message) => message.id === previousId)
            if (index !== -1) {
                const messagesToSend = messages.slice(index + 1)
                if (!messagesToSend.length) {
                    client.log(`No new messages ${channel}`)
                    return void null
                }
                messagesToSend.forEach(async (message) => {
                    const { id, type, mediaUrl } = message
                    const caption = await Translate(message.caption)
                    store[channel] = id
                    const replyData = type === 'text' ? caption : { url: mediaUrl }
                    await reply(replyData, type, caption)
                })
            }
            if (messages.length) {
                client.log(`Channel store: ${chalk.yellowBright(channel)}`)
                const latestMessage = messages.pop()
                const { id, type, mediaUrl } = latestMessage
                const caption = await Translate(latestMessage.caption)
                store[channel] = id
                const replyData = type === 'text' ? caption : { url: mediaUrl }
                await reply(replyData, type, caption)
            }
        })
        await Promise.all(promises)
    }

    app.get('/', (req, res) => res.status(200).contentType('image/png').send(client.QR))

    client.ev.on('creds.update', saveCreds)
    return client
}

start()
app.listen(port, () => console.log(`Server started on PORT : ${port}`))

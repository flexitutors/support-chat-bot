const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');
const pino = require('pino');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
app.use(express.urlencoded({ extended: true }));

let pairingCode = "Waiting for input...";
let sock;

// Dashboard UI
app.get('/', (req, res) => {
    res.send(`
        <html>
            <head>
                <style>
                    body { font-family: 'Segoe UI', sans-serif; background-color: #f4f7f6; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                    .card { background: white; padding: 40px; border-radius: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); text-align: center; width: 400px; }
                    input { padding: 12px; width: 100%; border: 1px solid #ddd; border-radius: 5px; margin-bottom: 10px; box-sizing: border-box; }
                    button { padding: 12px 20px; background: #25d366; color: white; border: none; border-radius: 5px; cursor: pointer; width: 100%; font-weight: bold; }
                    .code { font-size: 30px; font-weight: bold; color: #333; margin: 20px 0; letter-spacing: 5px; background: #eee; padding: 10px; border-radius: 5px; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h2>Edu-Connect Portal</h2>
                    <p>Enter your WhatsApp number to sync.</p>
                    <form action="/pair" method="POST">
                        <input type="text" name="phone" placeholder="e.g., 2348012345678" required>
                        <button type="submit">GENERATE LINK CODE</button>
                    </form>
                    <div class="code">${pairingCode}</div>
                    <p style="font-size: 12px; color: #888;">Secure Connection</p>
                </div>
            </body>
        </html>
    `);
});

app.post('/pair', async (req, res) => {
    const phoneNumber = req.body.phone;
    if (!sock) return res.send("System initializing...");
    try {
        pairingCode = await sock.requestPairingCode(phoneNumber);
        res.redirect('/');
    } catch (err) { res.send("Error: " + err.message); }
});

app.listen(port);

// Bot Engine
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    sock = makeWASocket({ logger: pino({ level: 'silent' }), auth: state });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (msg.key.fromMe || !msg.message) return;

        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "");
        
               try {
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
            const prompt = `
You are a human representative for an educational consulting firm.
1. NEVER mention you are an AI. Speak as a human representative.
2. GREETINGS: Respond politely and ask how you can assist with educational needs.
3. EDUCATIONAL: Answer academic questions briefly, then bridge to our services.
4. SERVICES: Use this price list:
   - JAMB/WAEC classes: 6,000 Naira
   - PostUTME classes: 7,000 Naira
   - WAEC/NECO Expo: Maths/English 2,000 Naira, Others 1,000 Naira
   - Admission Counseling: 2,000 Naira
   - WAEC Original Certificate: 15,000 Naira
   - WAEC Scratch card: 7,000 Naira
   - WAEC Result: 8,000 Naira
   - NECO Token: 3,000 Naira
   - NECO Result: 4,000 Naira
   - JAMB ePIN: 10,000 Naira
   - State of Origin: 12,000 Naira
   - Assignment/Projects: Ask for details to provide a quote.
5. OTHER: If message is spam or not educational/greeting, reply ONLY with "IGNORE".
Message: "${text}"`;

            const result = await model.generateContent(prompt);
            const responseText = result.response.text().trim();
            if (responseText !== "IGNORE") await sock.sendMessage(msg.key.remoteJid, { text: responseText });
        } catch (e) { console.error(e); }
    });

    sock.ev.on('connection.update', (update) => {
        if (update.connection === 'close') startBot();
    });
}

startBot();

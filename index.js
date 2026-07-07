const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    downloadMediaMessage
} = require("@whiskeysockets/baileys");

const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');
const pino = require('pino');
const { fileTypeFromBuffer } = require("file-type");
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));

let pairingCode = "Waiting for input...";
let sock;

let autoReplyEnabled = true;
let autoEnableTimer = null;

function scheduleAutoEnable(minutes = 30) {
    clearTimeout(autoEnableTimer);

    autoEnableTimer = setTimeout(() => {
        autoReplyEnabled = true;
        console.log("✅ Auto-reply automatically enabled.");
    }, minutes * 60 * 1000);
}

// ===============================
// Dashboard UI
// ===============================
app.get('/', (req, res) => {
    res.send(`
        <html>
            <head>
                <title>Edu-Connect Portal</title>
                <style>
                    *{
                        margin:0;
                        padding:0;
                        box-sizing:border-box;
                    }

                    body{
                        font-family:'Segoe UI',sans-serif;
                        background:#f4f7f6;
                        display:flex;
                        justify-content:center;
                        align-items:center;
                        height:100vh;
                    }

                    .card{
                        background:#fff;
                        width:400px;
                        padding:40px;
                        border-radius:15px;
                        box-shadow:0 4px 15px rgba(0,0,0,.1);
                        text-align:center;
                    }

                    h2{
                        margin-bottom:10px;
                    }

                    p{
                        margin-bottom:20px;
                    }

                    input{
                        width:100%;
                        padding:12px;
                        border:1px solid #ddd;
                        border-radius:5px;
                        margin-bottom:10px;
                        font-size:15px;
                    }

                    button{
                        width:100%;
                        padding:12px;
                        background:#25d366;
                        color:#fff;
                        border:none;
                        border-radius:5px;
                        font-weight:bold;
                        cursor:pointer;
                    }

                    button:hover{
                        opacity:.9;
                    }

                    .code{
                        margin-top:20px;
                        padding:12px;
                        background:#eee;
                        border-radius:5px;
                        font-size:30px;
                        letter-spacing:5px;
                        font-weight:bold;
                        color:#333;
                    }

                    .footer{
                        margin-top:15px;
                        color:#888;
                        font-size:12px;
                    }
                </style>
            </head>

            <body>

                <div class="card">

                    <h2>Edu-Connect Portal</h2>

                    <p>Enter your WhatsApp number to sync.</p>

                    <form action="/pair" method="POST">

                        <input
                            type="text"
                            name="phone"
                            placeholder="e.g. 2348012345678"
                            required
                        >

                        <button type="submit">
                            GENERATE LINK CODE
                        </button>

                    </form>

                    <div class="code">
                        ${pairingCode}
                    </div>

                    <div class="footer">
                        Secure Connection
                    </div>

                </div>

            </body>

        </html>
    `);
});

// ===============================
// Pairing Route
// ===============================
app.post('/pair', async (req, res) => {
    const phoneNumber = req.body.phone;

    if (!sock) {
        return res.send("System initializing...");
    }


    try {
        pairingCode = await sock.requestPairingCode(phoneNumber);
        res.redirect('/');
    } catch (err) {
        res.send("Error: " + err.message);
    }
});

// ===============================
// Start Express Server
// ===============================
app.listen(port, () => {
    console.log(`Dashboard running on port ${port}`);
});

// ===============================
// Gemini AI
// ===============================
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ===============================
// WhatsApp Bot
// ===============================
async function startBot() {
    const { state, saveCreds } =
        await useMultiFileAuthState("auth_info");

    sock = makeWASocket({
        logger: pino({ level: "silent" }),
        auth: state
    });

    sock.ev.on("creds.update", saveCreds);

sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;

        const msg = messages[0];
        const isImage = !!msg.message?.imageMessage;

        if (!msg.message) return;

        const text =
    msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    msg.message.imageMessage?.caption ||
    "";

// Owner commands (messages sent by the paired account)
if (msg.key.fromMe) {

    const cmd = text.trim().toLowerCase();

    if (cmd === "!off") {
        autoReplyEnabled = false;
        scheduleAutoEnable(30);

        await sock.sendMessage(msg.key.remoteJid, {
            text: "✅ Auto-reply disabled for 30 minutes."
        });

        return;
    }

    if (cmd === "!on") {
        autoReplyEnabled = true;
        clearTimeout(autoEnableTimer);

        await sock.sendMessage(msg.key.remoteJid, {
            text: "✅ Auto-reply enabled."
        });

        return;
    }

    if (cmd === "!status") {

        await sock.sendMessage(msg.key.remoteJid, {
            text: autoReplyEnabled
                ? "🟢 Auto-reply is ON."
                : "🔴 Auto-reply is OFF."
        });

        return;
    }

    return;
}

if (!autoReplyEnabled) return;
        try {
            const model = genAI.getGenerativeModel({
                model: "gemini-2.5-flash"
            });

            const prompt = `
You are a human representative for an educational consulting firm.

1. NEVER mention you are an AI. Speak as a human representative.

2. GREETINGS:
Respond politely and ask how you can assist with educational needs.

3. EDUCATIONAL:
Answer academic questions briefly, then bridge to our services.

4. SERVICES:
Use this exact price list:

- JAMB/WAEC classes: 6,000 Naira
- PostUTME classes: 7,000 Naira
- WAEC/NECO Expo:
  • Maths/English: 2,000 Naira
  • Other Subjects: 1,000 Naira
- Admission Counseling: 2,000 Naira
- WAEC Original Certificate: 15,000 Naira
- WAEC Scratch Card: 7,000 Naira
- WAEC Result Checker: 8,000 Naira
- NECO Token: 3,000 Naira
- NECO Result Checker: 4,000 Naira
- JAMB ePIN: 10,000 Naira
- State of Origin: 12,000 Naira
- Assignment/Projects:
  Ask for details before giving a quotation.
5. IMAGE MESSAGES:
If the user sends an image:

- If it is a payment receipt, reply:
"Thank you for sending your payment receipt. We are connecting you to our payment verification team. Kindly wait while your payment is being confirmed."

- If it is an assignment, solve it.

- If it is a mathematics, chemistry, physics, biology or other educational question, answer it.

- If it is a document, explain it.

- If it is unrelated to education, respond politely.

6. OTHER:
If the message is spam or unrelated to education or greetings,
reply ONLY with:

IGNORE

Message:
"${text}"
`;

let result;

if (isImage) {

    const buffer = await downloadMediaMessage(
        msg,
        "buffer",
        {},
        {
            logger: pino({ level: "silent" }),
            reuploadRequest: sock.updateMediaMessage
        }
    );

    const fileType = await fileTypeFromBuffer(buffer);

    result = await model.generateContent([
        {
            inlineData: {
               mimeType: fileType.mime,
                data: buffer.toString("base64")
            }
        },
        prompt
    ]);

} else {

    result = await model.generateContent(prompt);

}

const responseText = 
result.response.text().trim();

            // Ignore immediately
            if (responseText === "IGNORE") return;

            // Show typing
            await sock.sendPresenceUpdate(
                "composing",
                msg.key.remoteJid
            );

            // Human-like typing delay
            const typingDelay = Math.min(
                Math.max(responseText.length * 40, 2000),
                8000
            );

            await new Promise(resolve =>
                setTimeout(resolve, typingDelay)
            );

            // Send reply
            await sock.sendMessage(msg.key.remoteJid, {
                text: responseText
            });

            // Stop typing
            await sock.sendPresenceUpdate(
                "paused",
                msg.key.remoteJid
            );

        } catch (e) {
            console.error("Gemini Error:", e);
        }
    });

    // ===============================
    // Connection Handler
    // ===============================
    sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {

        if (connection === "open") {
            console.log("✅ WhatsApp Connected");
        }

        if (connection === "close") {

            const shouldReconnect =
                lastDisconnect?.error?.output?.statusCode !==
                DisconnectReason.loggedOut;

            if (shouldReconnect) {
                console.log("🔄 Reconnecting...");
                startBot();
            } else {
                console.log("❌ Logged Out");
            }
        }
    });
}

// ===============================
// Start Bot
// ===============================
startBot();

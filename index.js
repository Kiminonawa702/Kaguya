const {
  default: WAConnect,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeInMemoryStore,
  Browsers,
  fetchLatestWaWebVersion
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const readline = require('readline');
const { Boom } = require("@hapi/boom");

const pairingCode = process.argv.includes("--pairing-code");
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));
const store = makeInMemoryStore({ logger: pino().child({ level: "silent", stream: "store" }) });

// Fungsi untuk mendapatkan status yang belum dibaca
async function getUnreadStatuses(client) {
  const chats = await client.groupMetadata('status@broadcast'); 
  const unreadStatuses = chats.participants.filter(participant => !participant.read); 
  return unreadStatuses;
}

async function WAStart() {
  const { state, saveCreds } = await useMultiFileAuthState("./sesi");
  const { version, isLatest } = await fetchLatestWaWebVersion().catch(() => fetchLatestBaileysVersion());
  console.log(`Silahkan masukin nomor Whatsapp kamu:\n\n\nContoh 628xxxxxxxx`);

  const client = WAConnect({
    logger: pino({ level: "silent" }),
    printQRInTerminal: !pairingCode,
    browser: Browsers.ubuntu("Chrome"),
    auth: state,
  });

  store.bind(client.ev);

  if (pairingCode && !client.authState.creds.registered) {
    const phoneNumber = await question(`Berhasil 🥳 `);
    let code = await client.requestPairingCode(phoneNumber);
    code = code?.match(/.{1,4}/g)?.join("-") || code;
    console.log(`⚠︎ Kode Whatsapp kamu : ` + code)
  }

  client.ev.on("messages.upsert", async (chatUpdate) => {
    //console.log(JSON.stringify(chatUpdate, undefined, 2))
    try {
      const m = chatUpdate.messages[0];
      if (!m.message) return;
      if (m.key && !m.key.fromMe && m.key.remoteJid === 'status@broadcast') {
        const allowedSenders = ["6281447477366@s.whatsapp.net", "6281457229553@s.whatsapp.net", ]; //disini isi nomer yang ingin agar bot tidak otomatis read sw dari list nomor dibawah 
        if (allowedSenders.includes(m.key.participant)) { return }
        // Hanya baca jika status belum dibaca
        if (!store.getChat(m.key.remoteJid)?.messages.get(m.key.id)?.read) {
          await client.readMessages([m.key]);
          setTimeout(() => {
            console.log("Berhasil melihat status", m.pushName, m.key.participant.split('@')[0]);
          }, 1000); // 1000 milliseconds = 1 second
        }
      }
    } catch (err) {
      console.log(err);
    }
  });

  client.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "close") {
      let reason = new Boom(lastDisconnect?.error)?.output.statusCode;
      if (reason === DisconnectReason.badSession) {
        console.log(`Sesi File Buruk, Silahkan Hapus Sesi dan Scan Lagi`);
        process.exit();
      } else if (reason === DisconnectReason.connectionClosed) {
        console.log("Koneksi ditutup, menyambung kembali....");
        WAStart();
      } else if (reason === DisconnectReason.connectionLost) {
        console.log("Koneksi Hilang dari Server, menyambung kembali...");
        WAStart();
      } else if (reason === DisconnectReason.connectionReplaced) {
        console.log("Koneksi Digantikan, Sesi Baru Dibuka, Silahkan Mulai Ulang Bot");
        process.exit();
      } else if (reason === DisconnectReason.loggedOut) {
        console.log(`Perangkat Keluar, Silahkan Hapus Folder Sesi dan Scan Lagi.`);
        process.exit();
      } else if (reason === DisconnectReason.restartRequired) {
        console.log("Mulai Ulang Diperlukan, Memulai Ulang...");
        WAStart();
      } else if (reason === DisconnectReason.timedOut) {
        console.log("Koneksi Habis Waktu, Menyambun Kembali...");
        WAStart();
      } else {
        console.log(`Alasan Disconnect Tidak Diketahui: ${reason}|${connection}`);
        WAStart();
      }
    } else if (connection === "open") {
      console.log("Terhubung ke Readsw");

      // Loop untuk membaca status yang belum dibaca setiap 5 detik
      setInterval(async () => {
        const unreadStatuses = await getUnreadStatuses(client);
        if (unreadStatuses.length > 0) {
          for (const participant of unreadStatuses) {
            try {
              // Hanya baca jika status belum dibaca
              if (!store.getChat('status@broadcast')?.messages.get(participant.id)?.read) {
                await client.readMessages([
                  { remoteJid: 'status@broadcast', id: participant.id, participant: participant.id },
                ]);
                console.log(`Berhasil melihat status ${participant.id}`);
              }
            } catch (err) {
              console.error(`Gagal membaca status: ${err}`);
            }
          }
        }
      }, 5000); // 5000 milliseconds = 5 seconds
    }
  });

  client.ev.on("creds.update", saveCreds);

  return client;
}

WAStart();
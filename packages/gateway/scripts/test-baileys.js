async function main() {
  try {
    const baileys = await import('@whiskeysockets/baileys');
    const keys = Object.keys(baileys);
    console.log('baileys loaded OK, exports:', keys.slice(0, 10).join(', '));
    if (baileys.makeWASocket) console.log('makeWASocket: present');
    if (baileys.useMultiFileAuthState) console.log('useMultiFileAuthState: present');
    process.exit(0);
  } catch (err) {
    console.error('baileys load FAILED:', err.message);
    process.exit(1);
  }
}
main();

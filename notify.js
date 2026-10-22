// Kirim jadwal leader ke grup WhatsApp lewat Fonnte.
// Dijalankan oleh GitHub Actions (lihat .github/workflows/jadwal-notif.yml).
// Token tidak ditulis di sini: diambil dari GitHub Secret FONNTE_TOKEN.

const SHEET_ID = process.env.SHEET_ID || '1a1LkxYffa0luMgRG0_aDGEa4IVOhpJ380QBPsTvsosU';
const SHEET_GID = process.env.SHEET_GID || '0';
const MODE = process.env.MODE_KIRIM || 'besok';          // 'besok' atau 'hari_ini'
const TZ = 'Asia/Jakarta';
const OFF_CODES = { X: 'Libur' };
const CODE_LABELS = {};                                    // contoh: { AL: 'Cuti' }

// Pesan ditahan Fonnte sampai jam ini (WIB), supaya tidak terpengaruh telat-nya GitHub Actions.
const JAM_KIRIM_WIB = 21;
// Kalau jam kirim masih lebih dari sekian jam lagi, kirim langsung (anggap run tidak wajar).
const MAKS_TUNDA_JAM = 6;

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const BLN = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, agu: 8, agt: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, des: 12 };
const pad = n => String(n).padStart(2, '0');

function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function tanggalTarget(now = Date.now(), mode = MODE) {
  const t = new Date(now + (mode === 'besok' ? 86400000 : 0));
  const o = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric' })
    .formatToParts(t).forEach(p => { o[p.type] = +p.value; });
  return { d: o.day, m: o.month, y: o.year, wd: new Date(Date.UTC(o.year, o.month - 1, o.day)).getUTCDay() };
}

// Unix timestamp (detik) untuk jam kirim hari ini (WIB), atau null kalau pesan sebaiknya dikirim langsung.
// Fonnte hanya menerima waktu di masa depan, jadi kalau jam kirim sudah lewat -> null.
function waktuJadwal(now = Date.now()) {
  const t = tanggalTarget(now, 'hari_ini');                       // tanggal hari ini menurut WIB
  const kirimMs = Date.UTC(t.y, t.m - 1, t.d, JAM_KIRIM_WIB - 7, 0, 0); // WIB = UTC+7
  const selisih = kirimMs - now;
  if (selisih > 60 * 1000 && selisih <= MAKS_TUNDA_JAM * 3600 * 1000) return Math.floor(kirimMs / 1000);
  return null;
}

function headerDM(s) {
  s = String(s || '').trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return { d: +m[3], m: +m[2] };
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})/))) return { d: +m[1], m: +m[2] };
  if ((m = s.match(/^(\d{1,2})[\s\-\.]*([A-Za-z]{3,})/))) {
    const mon = BLN[m[2].slice(0, 3).toLowerCase()];
    if (mon) return { d: +m[1], m: mon };
  }
  return null;
}

function bangunPesan(rows, target, mode = MODE) {
  const cell = (r, c) => String((rows[r] && rows[r][c]) || '').trim();
  const hdr = rows.findIndex(r => String(r[0] || '').trim().toUpperCase() === 'NAMA');
  if (hdr < 0) throw new Error('Baris "NAMA" tidak ditemukan. Pastikan sheet bisa dibaca publik.');

  let col = -1;
  for (let c = 1; c < rows[hdr].length; c++) {
    const dm = headerDM(rows[hdr][c]);
    if (dm && dm.d === target.d && dm.m === target.m) { col = c; break; }
  }
  if (col < 0) throw new Error(`Tanggal ${target.d} ${BULAN[target.m - 1]} tidak ada di spreadsheet. Pesan tidak dikirim.`);

  const shifts = {};
  const lg = rows.findIndex(r => String(r[0] || '').trim().toUpperCase() === 'KODE SHIFT');
  if (lg >= 0) {
    for (let r = lg + 1; r < rows.length; r++) {
      const code = cell(r, 0).toUpperCase();
      if (!code) break;
      const m = cell(r, 1).match(/(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})/);
      if (m) shifts[code] = { start: +m[1] * 60 + +m[2], label: `${pad(+m[1])}:${m[2]}–${pad(+m[3])}:${m[4]}` };
    }
  }

  const wkRow = rows[hdr + 1] || [];
  const hasWk = wkRow.some((v, i) => i > 0 && String(v).trim() !== '');
  const bekerja = {}, lain = [];
  for (let r = hdr + (hasWk ? 2 : 1); r < rows.length; r++) {
    const nama = cell(r, 0);
    if (!nama) break;
    const code = cell(r, col).toUpperCase();
    if (!code) { lain.push({ nama, teks: 'belum diisi' }); continue; }
    if (OFF_CODES[code]) { lain.push({ nama, teks: OFF_CODES[code] }); continue; }
    if (shifts[code]) { (bekerja[code] = bekerja[code] || []).push(nama); continue; }
    lain.push({ nama, teks: CODE_LABELS[code] ? `${code} · ${CODE_LABELS[code]}` : code });
  }

  const judul = mode === 'besok' ? 'JADWAL LEADER BESOK' : 'JADWAL LEADER HARI INI';
  const baris = [`📅 *${judul}*`, `${HARI[target.wd]}, ${target.d} ${BULAN[target.m - 1]} ${target.y}`, ''];
  const kode = Object.keys(bekerja).sort((a, b) => shifts[a].start - shifts[b].start || a.localeCompare(b));
  if (kode.length) {
    kode.forEach(code => {
      baris.push(`🕒 *${shifts[code].label}* (${code})`);
      bekerja[code].forEach(n => baris.push(`• ${n}`));
      baris.push('');
    });
  } else baris.push('Tidak ada yang bertugas.', '');
  if (lain.length) {
    baris.push('🛌 *Tidak bertugas*');
    lain.forEach(o => baris.push(`• ${o.nama} – ${o.teks}`));
  }
  return baris.join('\n').replace(/\n+$/, '');
}

async function kirimWA(pesan, schedule) {
  const token = process.env.FONNTE_TOKEN;
  const target = process.env.WA_GROUP_ID;
  if (!token) throw new Error('FONNTE_TOKEN belum diisi di GitHub Secrets.');
  if (!target) throw new Error('WA_GROUP_ID belum diisi.');
  const data = { target, message: pesan };
  if (schedule) data.schedule = String(schedule);          // unix timestamp (detik)
  const res = await fetch('https://api.fonnte.com/send', {
    method: 'POST',
    headers: { Authorization: token },
    body: new URLSearchParams(data)
  });
  const body = await res.text();
  console.log(`Fonnte: HTTP ${res.status} ${body}`);
  let json = null;
  try { json = JSON.parse(body); } catch (e) {}
  if (!res.ok || (json && json.status === false)) throw new Error('Fonnte gagal mengirim: ' + body);
}

async function main() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gagal membaca spreadsheet: HTTP ${res.status}. Pastikan akses "Siapa saja yang memiliki link".`);
  const pesan = bangunPesan(parseCSV(await res.text()), tanggalTarget());
  console.log('--- Pesan ---\n' + pesan + '\n-------------');

  const jadwalKirim = waktuJadwal();
  if (jadwalKirim) console.log(`Pesan akan ditampilkan di grup pukul ${pad(JAM_KIRIM_WIB)}:00 WIB (unix ${jadwalKirim}).`);
  else console.log('Pesan dikirim sekarang (jam kirim sudah lewat atau masih terlalu jauh).');

  if (process.env.DRY_RUN === 'true') { console.log('DRY_RUN aktif: tidak dikirim ke WhatsApp.'); return; }
  await kirimWA(pesan, jadwalKirim);
  console.log('Terkirim ke Fonnte.');
}

if (require.main === module) main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
module.exports = { parseCSV, tanggalTarget, bangunPesan, waktuJadwal };

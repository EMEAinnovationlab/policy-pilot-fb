const crypto = require('crypto');
const Busboy = require('busboy');
const XLSX = require('xlsx');
const { parse: csvParse } = require('csv-parse/sync');
const { supabaseRest } = require('../lib/supabase');

function handleSpreadsheetUpload(req, res) {
  try {
    const bb = Busboy({
      headers: req.headers,
      limits: { files: 1, fileSize: 25 * 1024 * 1024 }
    });

    let fileBuf = Buffer.alloc(0);
    let filename = '';
    const fields = {};

    bb.on('file', (_name, file, info) => {
      filename = info.filename || 'upload';
      file.on('data', chunk => {
        fileBuf = Buffer.concat([fileBuf, chunk]);
      });
    });

    bb.on('field', (name, val) => {
      fields[name] = val;
    });

    bb.on('finish', async () => {
      try {
        const isXlsx = filename.toLowerCase().endsWith('.xlsx');
        const isCsv = filename.toLowerCase().endsWith('.csv');
        const ext = isXlsx ? 'xlsx' : (isCsv ? 'csv' : 'csv');

        const records = [];

        if (ext === 'xlsx') {
          const wb = XLSX.read(fileBuf, { type: 'buffer' });
          const sheet = wb.SheetNames[0];
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { raw: false });
          for (const row of rows) records.push(row);
        } else {
          const text = fileBuf.toString('utf8');
          const rows = csvParse(text, { columns: true, skip_empty_lines: true });
          for (const row of rows) records.push(row);
        }

        const docName = (fields.doc_name || '').trim() || filename;
        const uploadedBy = (fields.uploaded_by || '').trim() || 'admin';

        if ((fields.action || '').toLowerCase() === 'preview') {
          return res.json({
            ok: true,
            mode: 'preview',
            rows: records.slice(0, 50),
            doc_name: docName,
            total_rows: records.length
          });
        }

        if (!records.length) {
          return res.json({ ok: true, count: 0, doc_name: docName });
        }

        const documentId = crypto.randomUUID();

        const payload = records.map((row, idx) => ({
          document_id: documentId,
          doc_name: docName,
          uploaded_by: uploadedBy,
          chunk_index: idx,
          datum: row.datum ?? null,
          naam: row.naam ?? null,
          bron: row.bron ?? null,
          link: row.link ?? null,
          invloed_text: row.invloed_text ?? null,
          content: row.content ?? JSON.stringify(row)
        }));

        await supabaseRest('/documents', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: payload
        });

        res.json({
          ok: true,
          count: payload.length,
          doc_name: docName,
          document_id: documentId
        });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message || String(e) });
      }
    });

    req.pipe(bb);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
}

module.exports = {
  handleSpreadsheetUpload
};
const crypto = require('crypto');
const Busboy = require('busboy');
const XLSX = require('xlsx');
const { parse: csvParse } = require('csv-parse/sync');
const OpenAI = require('openai');
const { supabaseRest } = require('../lib/supabase');
const {
  OPENAI_API_KEY
} = require('../config/env');

const EMBED_MODEL = 'text-embedding-3-small';

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY
});

function normalizeValue(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function rowToPayload(row, idx, documentId, docName, uploadedBy, embeddings = {}) {
  const content =
    normalizeValue(row.content) ??
    normalizeValue(row.samenvatting) ??
    JSON.stringify(row);

  const invloedText =
    normalizeValue(row.invloed_text) ??
    normalizeValue(row.invloed) ??
    null;

  return {
    document_id: documentId,
    doc_name: docName,
    uploaded_by: uploadedBy,
    chunk_index: idx,
    datum: normalizeValue(row.datum),
    naam: normalizeValue(row.naam) ?? normalizeValue(row.name),
    bron: normalizeValue(row.bron),
    link: normalizeValue(row.link),
    invloed_text: invloedText,
    content,
    embedding: embeddings.embedding ?? null,
    invloed_embedding: embeddings.invloed_embedding ?? null,
    metadata: {
      source: 'uploadService.js',
      file_type: 'spreadsheet'
    }
  };
}

async function createEmbeddingsForRows(records) {
  const contentInputs = records.map((row) => {
    return (
      normalizeValue(row.content) ??
      normalizeValue(row.samenvatting) ??
      JSON.stringify(row)
    );
  });

  const invloedInputs = records.map((row) => {
    return (
      normalizeValue(row.invloed_text) ??
      normalizeValue(row.invloed) ??
      ''
    );
  });

  const contentResponse = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: contentInputs
  });

  const invloedResponse = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: invloedInputs
  });

  return records.map((_, i) => ({
    embedding: contentResponse.data[i]?.embedding ?? null,
    invloed_embedding: invloedInputs[i].trim()
      ? (invloedResponse.data[i]?.embedding ?? null)
      : null
  }));
}

function recordsToCsv(records, documentId, docName, uploadedBy) {
  const headers = [
    'document_id',
    'doc_name',
    'uploaded_by',
    'chunk_index',
    'datum',
    'naam',
    'bron',
    'link',
    'invloed_text',
    'content'
  ];

  const escaped = (value) => {
    const s = value == null ? '' : String(value);
    if (s.includes('"') || s.includes(',') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const rows = records.map((row, idx) => {
    const mapped = rowToPayload(row, idx, documentId, docName, uploadedBy);
    return headers.map((h) => escaped(mapped[h])).join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

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
      file.on('data', (chunk) => {
        fileBuf = Buffer.concat([fileBuf, chunk]);
      });
    });

    bb.on('field', (name, val) => {
      fields[name] = val;
    });

    bb.on('finish', async () => {
      try {
        const lower = filename.toLowerCase();
        const isXlsx = lower.endsWith('.xlsx');
        const isCsv = lower.endsWith('.csv');

        if (!isXlsx && !isCsv) {
          return res.status(400).json({
            ok: false,
            error: 'Unsupported file type. Please upload a .xlsx or .csv file.'
          });
        }

        const records = [];

        if (isXlsx) {
          const wb = XLSX.read(fileBuf, { type: 'buffer' });
          const sheet = wb.SheetNames[0];
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { raw: false });
          for (const row of rows) records.push(row);
        } else {
          const text = fileBuf.toString('utf8');
          const rows = csvParse(text, {
            columns: true,
            skip_empty_lines: true
          });
          for (const row of rows) records.push(row);
        }

        const docName = (fields.doc_name || '').trim() || filename;
        const uploadedBy = (fields.uploaded_by || '').trim() || 'admin';
        const action = (fields.action || '').toLowerCase();

        if (!records.length) {
          return res.json({
            ok: true,
            mode: action || 'upload',
            count: 0,
            rows: [],
            doc_name: docName
          });
        }

        const documentId = crypto.randomUUID();

        if (action === 'preview') {
          const previewRows = records.map((row, idx) =>
            rowToPayload(row, idx, documentId, docName, uploadedBy)
          );

          const csv = recordsToCsv(records, documentId, docName, uploadedBy);

          return res.json({
            ok: true,
            mode: 'preview',
            rows: previewRows.slice(0, 50),
            total_rows: previewRows.length,
            doc_name: docName,
            document_id: documentId,
            csv
          });
        }

        if (!OPENAI_API_KEY) {
          return res.status(500).json({
            ok: false,
            error: 'Missing OPENAI_API_KEY in server environment.'
          });
        }

        const embeddingRows = await createEmbeddingsForRows(records);

        const payload = records.map((row, idx) =>
          rowToPayload(
            row,
            idx,
            documentId,
            docName,
            uploadedBy,
            embeddingRows[idx]
          )
        );

        await supabaseRest('/documents', {
          method: 'POST',
          headers: {
            Prefer: 'return=minimal'
          },
          body: payload
        });

        return res.json({
          ok: true,
          count: payload.length,
          doc_name: docName,
          document_id: documentId
        });
      } catch (e) {
        console.error('Spreadsheet upload failed:', e);
        return res.status(500).json({
          ok: false,
          error: e.message || String(e)
        });
      }
    });

    req.pipe(bb);
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message || String(e)
    });
  }
}

module.exports = {
  handleSpreadsheetUpload
};
const crypto = require('crypto');
const Busboy = require('busboy');
const XLSX = require('xlsx');
const { parse: csvParse } = require('csv-parse/sync');
const OpenAI = require('openai');
const { supabaseRest } = require('../lib/supabase');

const EMBED_MODEL = 'text-embedding-3-small';
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

function normalizeValue(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

function buildContent(row) {
  return (
    normalizeValue(row.content) ||
    normalizeValue(row.samenvatting) ||
    JSON.stringify(row)
  );
}

function buildInvloedText(row) {
  return (
    normalizeValue(row.invloed_text) ||
    normalizeValue(row.invloed) ||
    null
  );
}

function mapRow(row, idx, documentId, docName, uploadedBy, vectors = {}) {
  return {
    document_id: documentId,
    doc_name: docName,
    uploaded_by: uploadedBy,
    chunk_index: idx,
    datum: normalizeValue(row.datum),
    naam: normalizeValue(row.naam) || normalizeValue(row.name),
    bron: normalizeValue(row.bron),
    link: normalizeValue(row.link),
    invloed_text: buildInvloedText(row),
    content: buildContent(row),
    embedding: vectors.embedding || null,
    invloed_embedding: vectors.invloed_embedding || null,
    metadata: {
      source: 'uploadService.js',
      file_type: 'spreadsheet'
    }
  };
}

function rowsToPreviewCsv(records, documentId, docName, uploadedBy) {
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

  function escapeCsv(value) {
    const s = value == null ? '' : String(value);
    if (s.includes('"') || s.includes(',') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  const lines = records.map((row, idx) => {
    const mapped = mapRow(row, idx, documentId, docName, uploadedBy);
    return headers.map((h) => escapeCsv(mapped[h])).join(',');
  });

  return [headers.join(','), ...lines].join('\n');
}

async function createEmbeddings(records) {
  if (!records.length) return [];

  const contentInputs = records.map((row) => buildContent(row));
  const invloedInputs = records.map((row) => buildInvloedText(row) || '');

  const contentResult = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: contentInputs
  });

  const invloedResult = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: invloedInputs
  });

  return records.map((_, i) => ({
    embedding: contentResult.data[i]?.embedding || null,
    invloed_embedding: invloedInputs[i].trim()
      ? (invloedResult.data[i]?.embedding || null)
      : null
  }));
}

function parseSpreadsheetBuffer(fileBuf, filename) {
  const lower = String(filename || '').toLowerCase();
  const isXlsx = lower.endsWith('.xlsx');
  const isCsv = lower.endsWith('.csv');

  if (!isXlsx && !isCsv) {
    throw new Error('Unsupported file type. Please upload a .xlsx or .csv file.');
  }

  if (isXlsx) {
    const wb = XLSX.read(fileBuf, { type: 'buffer' });
    const firstSheetName = wb.SheetNames[0];
    if (!firstSheetName) return [];
    return XLSX.utils.sheet_to_json(wb.Sheets[firstSheetName], { raw: false });
  }

  const text = fileBuf.toString('utf8');
  return csvParse(text, {
    columns: true,
    skip_empty_lines: true
  });
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
        if (!fileBuf.length) {
          return res.status(400).json({
            ok: false,
            error: 'No file uploaded.'
          });
        }

        const records = parseSpreadsheetBuffer(fileBuf, filename);
        const docName = (fields.doc_name || '').trim() || filename || 'Untitled';
        const uploadedBy = (fields.uploaded_by || '').trim() || 'admin';
        const action = (fields.action || 'upload').toLowerCase();
        const documentId = crypto.randomUUID();

        if (!records.length) {
          return res.json({
            ok: true,
            mode: action,
            rows: [],
            total_rows: 0,
            count: 0,
            doc_name: docName,
            document_id: documentId,
            csv: ''
          });
        }

        if (action === 'preview') {
          const previewRows = records.map((row, idx) =>
            mapRow(row, idx, documentId, docName, uploadedBy)
          );

          return res.json({
            ok: true,
            mode: 'preview',
            rows: previewRows.slice(0, 50),
            total_rows: previewRows.length,
            doc_name: docName,
            document_id: documentId,
            csv: rowsToPreviewCsv(records, documentId, docName, uploadedBy)
          });
        }

        if (!process.env.OPENAI_API_KEY) {
          return res.status(500).json({
            ok: false,
            error: 'Missing OPENAI_API_KEY on the server.'
          });
        }

        const vectors = await createEmbeddings(records);

        const payload = records.map((row, idx) =>
          mapRow(row, idx, documentId, docName, uploadedBy, vectors[idx])
        );

        await supabaseRest('/documents_fb', {
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

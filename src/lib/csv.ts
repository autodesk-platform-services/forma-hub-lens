/**
 * Streaming RFC-4180 CSV reader.
 *
 * Data Connector extracts routinely run to hundreds of megabytes, so rows are
 * yielded as they are parsed rather than materialising the whole file. Handles
 * quoted fields, escaped quotes, embedded newlines and CRLF.
 */
export async function* parseCsv(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string[], void, void> {
  const decoder = new TextDecoder("utf-8");
  const reader = stream.getReader();

  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let quoteJustClosed = false;
  let sawAnyChar = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      for (let i = 0; i < chunk.length; i++) {
        const char = chunk[i];
        sawAnyChar = true;

        if (inQuotes) {
          if (char === '"') {
            inQuotes = false;
            quoteJustClosed = true;
          } else {
            field += char;
          }
          continue;
        }

        if (quoteJustClosed && char === '"') {
          // "" inside a quoted field is a literal quote.
          field += '"';
          inQuotes = true;
          quoteJustClosed = false;
          continue;
        }
        quoteJustClosed = false;

        if (char === '"' && field.length === 0) {
          inQuotes = true;
        } else if (char === ",") {
          pushField();
        } else if (char === "\n") {
          pushField();
          yield row;
          row = [];
        } else if (char !== "\r") {
          field += char;
        }
      }
    }

    if (inQuotes) throw new Error("unterminated quoted CSV field");

    // Trailing row without a newline terminator.
    if (sawAnyChar && (field.length > 0 || row.length > 0)) {
      pushField();
      yield row;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Yields each data row as a header-keyed record. */
export async function* parseCsvRecords(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<Record<string, string>, void, void> {
  let header: string[] | null = null;

  for await (const row of parseCsv(stream)) {
    if (!header) {
      // Strip a UTF-8 BOM if the exporter left one on the first column name.
      header = row.map((name, index) =>
        (index === 0 ? name.replace(/^﻿/, "") : name).trim(),
      );
      continue;
    }
    if (row.length === 1 && row[0] === "") continue; // blank line

    const record: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) record[header[i]] = row[i] ?? "";
    yield record;
  }
}

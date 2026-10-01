import { NextResponse, type NextRequest } from "next/server";
import { HubAdminRequiredError, UnauthorizedError, requireHubAdminSession } from "@/lib/aps/auth";
import { ingestZip, MAX_DATASET_ARCHIVE_BYTES } from "@/lib/dataset";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_BYTES = MAX_DATASET_ARCHIVE_BYTES;

/** Accepts a Data Connector CSV extract ZIP and loads every CSV into the cache. */
export async function POST(request: NextRequest) {
  try {
    await requireHubAdminSession();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof HubAdminRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json({ error: "Could not verify live Hub Admin access." }, { status: 503 });
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES + 1024 * 1024) {
    return NextResponse.json({ error: "Upload request exceeds the ZIP size limit." }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch (error) {
    return NextResponse.json(
      { error: `Could not read the upload: ${error instanceof Error ? error.message : error}` },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was attached." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "The uploaded file is empty." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That file is ${(file.size / 1024 / 1024).toFixed(0)} MB; the limit is ${MAX_BYTES / 1024 / 1024} MB.` },
      { status: 413 },
    );
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const summary = await ingestZip(file.name, bytes);
    if (summary.tables.length === 0) {
      return NextResponse.json(
        {
          error:
            "No CSV files were found in that archive. Upload the ZIP that Data Connector produced (it contains one .csv per table).",
          skipped: summary.skipped.slice(0, 20),
        },
        { status: 400 },
      );
    }
    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

import { NextResponse } from "next/server";
import { getSession } from "@/lib/aps/auth";
import { closeoutProject } from "@/lib/closeoutEngine";
import { readVerifiedCloseoutPackage } from "@/lib/closeoutPackage";
import { getCloseoutPackage } from "@/lib/closeoutStore";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new NextResponse("Sign in to download this package.", { status: 401 });
  const { id } = await params;
  const record = getCloseoutPackage(id);
  if (!record || !closeoutProject(record.projectId)) return new NextResponse("Package not found.", { status: 404 });
  try {
    const { bytes } = readVerifiedCloseoutPackage(id);
    return new NextResponse(new Uint8Array(bytes), { headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="closeout-${record.projectId}-${record.id}.zip"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, no-store",
    } });
  } catch {
    return new NextResponse("Saved package integrity check failed.", { status: 409 });
  }
}

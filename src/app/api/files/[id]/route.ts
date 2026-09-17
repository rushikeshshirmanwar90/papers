import { NextRequest, NextResponse } from "next/server";
import { openFile } from "@/lib/storage";

export const runtime = "nodejs";

// Serves an uploaded PDF or diagram from the StoredFile collection. Ids are
// never reused, so responses can be cached indefinitely by browser and CDN.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const file = await openFile(params.id);
  if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });

  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.size),
      "Content-Disposition": `inline; filename="${encodeURIComponent(file.filename)}"`,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

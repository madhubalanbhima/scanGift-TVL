import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import QRCode from "qrcode";
import { connectToDatabase } from "@/lib/mongodb";
import { Customer } from "@/models/Customer";
import * as fs from "fs";
import * as path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getBaseUrl(req: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_BASE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("host");
  return `${proto}://${host}`;
}

// Reads a file from public/images/ and returns a base64 data URI, or null if
// it can't be found/read — callers must handle the null case gracefully so a
// single missing asset never crashes the whole image.
function loadImageDataUri(filename: string, mime = "image/png"): string | null {
  try {
    const filePath = path.join(process.cwd(), "public/images", filename);
    const buffer = fs.readFileSync(filePath);
    return `data:${mime};base64,${buffer.toString("base64")}`;
  } catch (err) {
    console.error(`[voucher-image] Failed to load ${filename}:`, err);
    return null;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { voucherId: string } }
) {
  try {
    const rawVoucherId = decodeURIComponent(params.voucherId).trim();
    const normalizedVoucherId = rawVoucherId.replace(/^#/, "");
    const candidateIds = Array.from(
      new Set([rawVoucherId, normalizedVoucherId, `#${normalizedVoucherId}`])
    );

    await connectToDatabase();
    const customer = await Customer.findOne({ voucherId: { $in: candidateIds } }).lean();

    if (!customer) {
      console.error("[voucher-image] Voucher not found:", rawVoucherId);
      return new Response("Voucher not found", { status: 404 });
    }

    const voucherImage = loadImageDataUri("tvlVoucher.jpeg", "image/jpeg");

    let qrDataUrl: string | null = null;
    try {
      const scanUrl = `${getBaseUrl(req)}/voucher/${encodeURIComponent(customer.voucherId)}`;
      qrDataUrl = await QRCode.toDataURL(scanUrl, {
        margin: 1,
        width: 200,
        color: { dark: "#181511", light: "#ffffff" },
      });
    } catch (err) {
      console.error("[voucher-image] Failed to generate QR code:", err);
    }

    const issuedDate = new Date(customer.createdAt).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

    return new ImageResponse(
      (
        <div
          style={{
            width: "1200px",
            height: "630px",
            display: "flex",
            position: "relative",
            overflow: "hidden",
            background: "#1a1410",
          }}
        >
          {voucherImage && (
            <img
              src={voucherImage}
              width={1200}
              height={630}
              style={{ position: "absolute", inset: "0px", objectFit: "cover" }}
              alt="Bhima Tirunelveli gift voucher"
            />
          )}

          <div
            style={{
              position: "absolute",
              left: "808px",
              top: "35px",
              width: "140px",
              height: "140px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#ffffff",
              borderRadius: "4px",
              padding: "6px",
              boxSizing: "border-box",
            }}
          >
            {qrDataUrl && <img src={qrDataUrl} width={128} height={128} alt="Voucher verification QR code" />}
          </div>

          <div
            style={{
              position: "absolute",
              left: "955px",
              top: "65px",
              width: "190px",
              height: "110px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "2px solid #e6c76a",
              borderRadius: "8px",
              background: "rgba(38,79,43,0.96)",
              color: "#ffffff",
              fontSize: "24px",
              fontWeight: 700,
              lineHeight: 1.25,
              textAlign: "center",
            }}
          >
            Scan to verify this voucher
          </div>

          <div
            style={{
              position: "absolute",
              bottom: "12px",
              left: "24px",
              right: "24px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(26,55,30,0.9)",
              border: "1px solid #e6c76a",
              borderRadius: "8px",
              padding: "8px 16px",
            }}
          >
            <div
              style={{
                display: "flex",
                color: "#ffffff",
                fontSize: "18px",
                fontWeight: 700,
                letterSpacing: "0.5px",
                textAlign: "center",
              }}
            >
              {customer.fullName} · {customer.voucherId} · Issued {issuedDate}
            </div>
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        }
      }
    );
  } catch (err) {
    console.error("[voucher-image] Unhandled error:", err);
    return new Response("Failed to generate voucher image", { status: 500 });
  }
}
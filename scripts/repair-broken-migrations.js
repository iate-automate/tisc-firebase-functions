// Repairs records touched by the first (buggy) run of migrate-download-urls.js
// on 15 Sep 2026. That run hit two compounding bugs in the /files endpoint
// (a race condition that returned success before the upload finished, and a
// missing storage.objects.create permission on the app's Storage bucket --
// both now fixed) -- it wrote new-domain URLs back to Airtable for every
// record, but many of the underlying files were never actually created, so
// those URLs 404. Because the field now holds a NEW-domain URL, the original
// script's SEARCH("tisuk-web", ...) filter can no longer find these records.
//
// This script instead finds records whose field holds a NEW-domain URL,
// HEAD-checks whether the file actually exists, and for any that don't,
// reconstructs the original OLD-domain URL (same folder/filename, different
// bucket -- migrate-download-urls.js never changes the path) and re-runs the
// same fetch-and-reupload migration via /files.
//
// Safe to re-run: only touches records whose current URL 404s.
//
// Usage:
//   AIRTABLE_PAT=xxx node scripts/repair-broken-migrations.js            (dry run)
//   AIRTABLE_PAT=xxx node scripts/repair-broken-migrations.js --write    (live)

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const FILES_ENDPOINT = "https://europe-west2-tisc-functions.cloudfunctions.net/api/files"
const NEW_DOMAIN_MATCH = "tisc-functions"
const OLD_BUCKET = "tisuk-web.appspot.com"
const DRY_RUN = !process.argv.includes("--write")

const TARGETS = [
  { baseId: "appyRWiDNDiBpsoGC", tableId: "tblRFgBpUWbSWRNBH", tableName: "Assessments", fieldName: "Certificate URL" },
  { baseId: "appyRWiDNDiBpsoGC", tableId: "tbl4Pcec85e7tQiX7", tableName: "Email Templates", fieldName: "Attachment URL" },
  { baseId: "appyRWiDNDiBpsoGC", tableId: "tbl5Sco63TWT492Ht", tableName: "Resources", fieldName: "File URL" },
  { baseId: "app2wOtP8sc7JvYOw", tableId: "tblSpzvodQy9RS6iY", tableName: "Email Templates", fieldName: "Attachment URL" },
]

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Firebase Storage URLs look like:
//   https://firebasestorage.googleapis.com/v0/b/BUCKET/o/FOLDER%2FFILENAME.ext?alt=media
function parseFirebaseUrl(url) {
  const match = url.match(/\/o\/([^?]+)/)
  if (!match) return null
  const decodedPath = decodeURIComponent(match[1])
  const lastSlash = decodedPath.lastIndexOf("/")
  const folder = lastSlash === -1 ? "" : decodedPath.slice(0, lastSlash)
  const filename = lastSlash === -1 ? decodedPath : decodedPath.slice(lastSlash + 1)
  return { folder, filename }
}

function reconstructOldUrl(newUrl) {
  const parsed = parseFirebaseUrl(newUrl)
  if (!parsed) return null
  const encodedPath = encodeURIComponent(`${parsed.folder}/${parsed.filename}`)
  return `https://firebasestorage.googleapis.com/v0/b/${OLD_BUCKET}/o/${encodedPath}?alt=media`
}

async function urlExists(url) {
  const res = await fetch(url, { method: "HEAD" })
  return res.ok
}

async function getRealContentType(url) {
  const res = await fetch(url, { method: "HEAD" })
  const type = res.headers.get("content-type")
  return type || "application/octet-stream"
}

async function listMatchingRecords(target) {
  const records = []
  let offset
  do {
    const url = new URL(`https://api.airtable.com/v0/${target.baseId}/${target.tableId}`)
    url.searchParams.set("filterByFormula", `SEARCH("${NEW_DOMAIN_MATCH}", {${target.fieldName}})`)
    url.searchParams.append("fields[]", target.fieldName)
    if (offset) url.searchParams.set("offset", offset)

    const res = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_PAT}` } })
    if (!res.ok) throw new Error(`List failed for ${target.tableName}/${target.fieldName}: ${res.status} ${await res.text()}`)
    const data = await res.json()
    records.push(...data.records)
    offset = data.offset
  } while (offset)
  return records
}

async function repairOne(target, record) {
  const currentUrl = record.fields[target.fieldName]

  const alive = await urlExists(currentUrl)
  if (alive) {
    console.log(`  OK ${record.id}: file exists, skipping`)
    return
  }

  const oldUrl = reconstructOldUrl(currentUrl)
  if (!oldUrl) {
    console.log(`  SKIP ${record.id}: couldn't reconstruct old URL from: ${currentUrl}`)
    return
  }

  const sourceAlive = await urlExists(oldUrl)
  if (!sourceAlive) {
    console.log(`  UNRECOVERABLE ${record.id}: reconstructed source also missing: ${oldUrl}`)
    return
  }

  const parsed = parseFirebaseUrl(currentUrl)
  const realContentType = await getRealContentType(oldUrl)

  if (DRY_RUN) {
    console.log(`  WOULD REPAIR ${record.id}: ${parsed.folder}/${parsed.filename} (${realContentType})`)
    return
  }

  const filesRes = await fetch(FILES_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      airtableUrl: oldUrl,
      airtableFilename: parsed.filename,
      airtableFiletype: realContentType,
      firebaseFolder: parsed.folder,
    }),
  })
  const filesData = await filesRes.json()
  if (!filesRes.ok || !filesData.firebaseUrl) {
    console.log(`  FAILED ${record.id}: ${JSON.stringify(filesData)}`)
    return
  }

  // Confirm the repaired upload actually exists before touching Airtable.
  const nowAlive = await urlExists(filesData.firebaseUrl)
  if (!nowAlive) {
    console.log(`  FAILED ${record.id}: re-uploaded but still 404s at ${filesData.firebaseUrl}`)
    return
  }

  const patchRes = await fetch(`https://api.airtable.com/v0/${target.baseId}/${target.tableId}/${record.id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${AIRTABLE_PAT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: { [target.fieldName]: filesData.firebaseUrl } }),
  })
  if (!patchRes.ok) {
    console.log(`  FAILED writeback ${record.id}: ${await patchRes.text()}`)
    return
  }

  console.log(`  REPAIRED ${record.id}: ${parsed.filename}`)
}

async function main() {
  if (!AIRTABLE_PAT) {
    console.error("Set AIRTABLE_PAT before running.")
    process.exit(1)
  }
  console.log(DRY_RUN ? "DRY RUN -- no changes will be made. Pass --write to actually repair.\n" : "LIVE RUN -- changes will be written.\n")

  for (const target of TARGETS) {
    console.log(`\n${target.tableName} / ${target.fieldName}`)
    const records = await listMatchingRecords(target)
    console.log(`  ${records.length} record(s) pointing at the new domain`)
    for (const record of records) {
      await repairOne(target, record)
      await sleep(250) // stay well under Airtable's 5 req/s rate limit
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

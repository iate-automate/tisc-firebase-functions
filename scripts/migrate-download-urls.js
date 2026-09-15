// Migrates old Firebase Storage download URLs (stored in Airtable) from the
// old project (tisuk-web, Minnow-owned) to the new one (tisc-functions), via
// the new project's /files endpoint -- same mechanism used to migrate the
// font assets during the main migration. Ported from the IATE migration's
// scripts/migrate-download-urls.js (iate-firebase repo).
//
// Safe to re-run: once a record's URL is updated, it no longer matches the
// "tisuk-web" filter, so it naturally drops out of scope on the next run.
//
// TODO before running: fill in TARGETS below with TISC's actual base/table/
// field combinations that hold Firebase Storage URLs. Find them by searching
// TISC's Airtable base(s) (appyRWiDNDiBpsoGC / appul4ZPEgDmU1uPs) for fields
// containing "tisuk-web.appspot.com" or "firebasestorage.googleapis.com/v0/b/tisuk-web".
//
// Usage:
//   AIRTABLE_PAT=xxx node scripts/migrate-download-urls.js            (dry run)
//   AIRTABLE_PAT=xxx node scripts/migrate-download-urls.js --write    (live)

const AIRTABLE_PAT = process.env.AIRTABLE_PAT
const FILES_ENDPOINT = "https://europe-west2-tisc-functions.cloudfunctions.net/api/files"
const OLD_DOMAIN_MATCH = "tisuk-web"
const DRY_RUN = !process.argv.includes("--write")

const TARGETS = [
  // { baseId: "appyRWiDNDiBpsoGC", tableId: "tblXXXXXXXXXXXXXX", tableName: "TODO", fieldName: "TODO" },
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

// Guessing the content-type from the filename extension is unreliable --
// plenty of files in this system may have no extension in their stored path
// at all. Fetch the real content-type from the source file itself instead.
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
    url.searchParams.set("filterByFormula", `SEARCH("${OLD_DOMAIN_MATCH}", {${target.fieldName}})`)
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

async function migrateOne(target, record) {
  const oldUrl = record.fields[target.fieldName]
  const parsed = parseFirebaseUrl(oldUrl)
  if (!parsed) {
    console.log(`  SKIP ${record.id}: couldn't parse URL: ${oldUrl}`)
    return
  }

  const realContentType = await getRealContentType(oldUrl)

  if (DRY_RUN) {
    console.log(`  WOULD MIGRATE ${record.id}: ${parsed.folder}/${parsed.filename} (${realContentType})`)
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

  console.log(`  MIGRATED ${record.id}: ${parsed.filename} -> ${filesData.firebaseUrl}`)
}

async function main() {
  if (!AIRTABLE_PAT) {
    console.error("Set AIRTABLE_PAT before running.")
    process.exit(1)
  }
  if (TARGETS.length === 0) {
    console.error("TARGETS is empty -- fill in the base/table/field combinations before running (see TODO at top of file).")
    process.exit(1)
  }
  console.log(DRY_RUN ? "DRY RUN -- no changes will be made. Pass --write to actually migrate.\n" : "LIVE RUN -- changes will be written.\n")

  for (const target of TARGETS) {
    console.log(`\n${target.tableName} / ${target.fieldName}`)
    const records = await listMatchingRecords(target)
    console.log(`  ${records.length} record(s) with an old Firebase URL`)
    for (const record of records) {
      await migrateOne(target, record)
      await sleep(250) // stay well under Airtable's 5 req/s rate limit
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

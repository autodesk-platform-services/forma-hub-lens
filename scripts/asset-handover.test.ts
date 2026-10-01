import assert from "node:assert/strict";
import test from "node:test";
import { buildAssetHandover, type AssetEvidenceSource } from "../src/lib/assetHandover.ts";
import type { PackageFile } from "../src/lib/closeoutPackage.ts";
import type { SelectedRecord } from "../src/lib/closeoutStore.ts";

const source = (domain: AssetEvidenceSource["domain"], rows: Record<string, unknown>[], complete = true): AssetEvidenceSource => ({
  domain, rows, kind: "live-aps", revision: `live:${domain}:1`, complete,
  coverage: complete ? "verified-live" : "unverified", note: null,
});
const version = "urn:adsk.wipprod:fs.file:vf.file1?version=4";
const selection: SelectedRecord = { id: "selected-1", projectId: "project-1", domain: "files", externalId: "file-1",
  versionId: version, sourceRevision: "live:files:1", sourceKind: "live-aps", name: "Pump manual.pdf",
  selectedBy: "admin", selectedAt: 1 };
const packaged: PackageFile = { selectionId: "selected-1", sourceId: "file-1", versionId: version,
  displayName: "Pump manual.pdf", archivePath: "files/001-Pump_manual.pdf", sha256: "abc", byteSize: 20,
  storageUrn: "urn:adsk.objects:os.object:bucket/key", outcome: "included", reason: null };

test("asset handover builds an exact linked record with pinned packaged document and supporting workflows", () => {
  const entities = (domain: string, id: string) => [{ id: "asset-1", domain: "assets" }, { id, domain }];
  const sources = [
    source("assets", [{ id: "asset-1", name: "AHU-1", category: "HVAC", status: "Installed",
      location_id: "loc-1", location_path: "Building A/Level 1", Serial: "S-001", access_token: "MUST-NOT-LEAK" }]),
    source("relationships", [
      { id: "rel-file", relationship_type: "references", entities: entities("files", "file-1") },
      { id: "rel-form", entities: entities("forms", "form-1") },
      { id: "rel-issue", entities: entities("issues", "issue-1") },
      { id: "rel-rfi", entities: entities("rfis", "rfi-1") },
      { id: "rel-submittal", entities: entities("submittals", "submittal-1") },
      { id: "rel-photo", entities: entities("photos", "photo-1") },
      { id: "rel-location", entities: entities("locations", "loc-1") },
    ]),
    source("files", [{ id: "file-1", item_id: "file-1", version_id: version, name: "Pump manual.pdf" }]),
    source("forms", [{ id: "form-1", name: "Commissioning", status: "Complete" }]),
    source("issues", [{ id: "issue-1", title: "Inspection", status: "Closed" }]),
    source("rfis", [{ id: "rfi-1", title: "Capacity", status: "Answered" }]),
    source("submittals", [{ id: "submittal-1", title: "O&M", status: "Approved" }]),
    source("locations", [{ id: "loc-1", path: "Building A/Level 1" }]),
  ];
  const index = buildAssetHandover({ projectId: "project-1", sources, selections: [selection], packageFiles: [packaged] });
  assert.equal(index.assets.length, 1);
  const asset = index.assets[0];
  assert.equal(asset.id, "asset-1");
  assert.equal(asset.location.path, "Building A/Level 1");
  assert.equal(asset.metadata.Serial, "S-001");
  assert.equal(JSON.stringify(index).includes("MUST-NOT-LEAK"), false);
  assert.deepEqual(asset.links.map((link) => link.domain), ["files", "forms", "issues", "rfis", "submittals", "photos", "locations"]);
  const file = asset.links[0];
  assert.equal(file.resolution, "resolved");
  assert.equal(file.pinnedVersionId, version);
  assert.equal(file.archivePath, packaged.archivePath);
  assert.equal(file.outcome, "included");
  assert.equal(asset.links.find((link) => link.domain === "photos")?.resolution, "unverified");
  assert.ok(asset.unknownReasons.some((reason) => reason.detail.includes("photos")));
});

test("relationship evidence never matches fuzzy IDs and preserves unsupported or malformed endpoints as unknown", () => {
  const sources = [
    source("assets", [{ id: "asset-1", name: "AHU-1" }]),
    source("relationships", [
      { id: "rel-1", entities: [{ id: "asset-1", type: "asset" }, { id: "file", type: "document" }] },
      { id: "rel-2", entities: [{ id: "asset-1", domain: "assets" }, { id: "external-1", domain: "unknown-service" }] },
      { id: "rel-bad", arbitrary: "missing entities" },
    ]),
    source("files", [{ id: "file-1", item_id: "file-1", version_id: version, name: "Pump manual.pdf" }]),
  ];
  const index = buildAssetHandover({ projectId: "project-1", sources, selections: [], packageFiles: [] });
  assert.equal(index.assets[0].links.length, 1);
  assert.equal(index.assets[0].links[0].recordId, "file");
  assert.equal(index.assets[0].links[0].resolution, "unverified");
  assert.equal(index.assets[0].links[0].archivePath, null);
  assert.ok(index.assets[0].unknownReasons.some((reason) => reason.code === "unsupported-endpoint"));
  assert.ok(index.assets[0].unknownReasons.some((reason) => reason.code === "relationship-shape-unresolved"));
});

test("a version ID does not resolve a relationship when its item ID disagrees", () => {
  const index = buildAssetHandover({ projectId: "project-1", sources: [
    source("assets", [{ id: "asset-1", name: "AHU-1" }]),
    source("relationships", [{ id: "rel-1", entities: [
      { id: "asset-1", domain: "assets" }, { id: "different-file", version_id: version, domain: "files" },
    ] }]),
    source("files", [{ id: "file-1", item_id: "file-1", version_id: version, name: "Pump manual.pdf" }]),
  ], selections: [selection], packageFiles: [packaged] });
  const link = index.assets[0].links[0];
  assert.equal(link.resolution, "unverified");
  assert.equal(link.archivePath, null);
  assert.ok(index.assets[0].unknownReasons.some((reason) => reason.code === "linked-record-unverified"));
});

test("flat and nested endpoint CSV shapes yield the same exact asset links", () => {
  const index = buildAssetHandover({ projectId: "project-1", sources: [
    source("assets", [{ id: "asset-1", name: "AHU-1" }]),
    source("relationships", [
      { id: "flat", source_id: "asset-1", source_type: "asset", target_id: "file-1", target_type: "file" },
      { id: "nested", sourceEntity: { id: "asset-1", type: "asset" },
        targetEntity: { id: "form-1", type: "form" } },
    ]),
    source("files", [{ id: "file-1", item_id: "file-1", version_id: version, name: "Pump manual.pdf" }]),
    source("forms", [{ id: "form-1", name: "Commissioning" }]),
  ], selections: [selection], packageFiles: [packaged] });
  assert.deepEqual(index.assets[0].links.map((link) => [link.domain, link.recordId, link.resolution]),
    [["files", "file-1", "resolved"], ["forms", "form-1", "resolved"]]);
  assert.equal(index.unknownReasons.some((reason) => reason.code === "relationship-shape-unresolved"), false);
});

test("missing or incomplete relationship evidence leaves every asset's connections unknown", () => {
  const asset = source("assets", [{ id: "asset-1", name: "AHU-1", location_id: "loc-1" }]);
  for (const relationships of [undefined, source("relationships", [], false)]) {
    const index = buildAssetHandover({ projectId: "project-1", sources: relationships ? [asset, relationships] : [asset],
      selections: [], packageFiles: [] });
    assert.equal(index.assets[0].links.length, 0);
    assert.ok(index.assets[0].unknownReasons.some((reason) => reason.code === "relationships-unverified"));
    assert.ok(index.assets[0].unknownReasons.some((reason) => reason.code === "location-unverified"));
  }
});

test("asset metadata omits external links and credentials regardless of field naming", () => {
  const index = buildAssetHandover({ projectId: "project-1", sources: [
    source("assets", [{ id: "asset-1", name: "AHU-1", Serial: "S-001",
      href: "private-reference", document_link: "private-reference", uri: "private-reference",
      signed_url: "private-reference", download_url: "private-reference",
      note: "Manual at https://downloads.example/file?signature=PRIVATE",
      custom_attributes: { warranty: "2028-01-01", other: "data:text/plain,PRIVATE",
        callback: "javascript:PRIVATE", Authorization: "Bearer PRIVATE" } }]),
  ], selections: [], packageFiles: [] });
  assert.equal(index.assets[0].metadata.Serial, "S-001");
  assert.equal(index.assets[0].metadata.warranty, "2028-01-01");
  const serialized = JSON.stringify(index.assets[0].metadata);
  assert.equal(serialized.includes("PRIVATE"), false);
  assert.equal(serialized.includes("private-reference"), false);
});

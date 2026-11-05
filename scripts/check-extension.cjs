const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../Extension/Resources");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json")));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ["storage", "nativeMessaging"]);
for (const group of manifest.content_scripts) {
  assert.equal(group.matches.length, 5);
  for (const name of group.js) {
    assert.ok(fs.existsSync(path.join(root, name)), name);
    new vm.Script(fs.readFileSync(path.join(root, name), "utf8"), { filename: name });
  }
}
for (const name of [...manifest.background.scripts, "popup.js"]) new vm.Script(fs.readFileSync(path.join(root, name), "utf8"), { filename: name });
for (const file of Object.values(manifest.icons)) assert.ok(fs.existsSync(path.join(root, file)), file);
for (const file of manifest.web_accessible_resources.flatMap(r => r.resources)) assert.ok(fs.existsSync(path.join(root, file)), file);
const project = fs.readFileSync(path.resolve(__dirname, "../AniSkipSafari.xcodeproj/project.pbxproj"), "utf8");
assert.match(project, /MACOSX_DEPLOYMENT_TARGET = 27.0/);
for (const file of fs.readdirSync(root)) assert.ok(project.includes(`Extension/Resources/${file}`), `Unbundled resource: ${file}`);
console.log("Extension scripts, manifest resources, permissions, and macOS 27 deployment target verified.");

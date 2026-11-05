import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("release", ROOT / "scripts/release.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class VersionTests(unittest.TestCase):
    def test_conventional_commits_select_the_largest_bump(self):
        self.assertEqual(release.bump("1.2.3", ["fix: correct next episode"]), "1.2.4")
        self.assertEqual(release.bump("1.2.3", ["docs: update build guide"]), "1.2.4")
        self.assertEqual(release.bump("1.2.3", ["fix: a", "feat(player): add option"]), "1.3.0")
        self.assertEqual(release.bump("1.2.3", ["feat: a", "fix(api)!: change protocol"]), "2.0.0")
        self.assertEqual(release.bump("0.1.0", ["refactor: player\n\nBREAKING CHANGE: replace settings"]), "1.0.0")

    def test_invalid_extension_versions_are_rejected(self):
        for value in ("1.2", "01.2.3", "1.2.3-beta", "1.2.3\nother=x", "65536.0.0"):
            with self.assertRaises(ValueError):
                release.parse_version(value)


class RepositoryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.git("init", "-b", "main")
        self.git("config", "user.name", "Release tests")
        self.git("config", "user.email", "release-tests@example.invalid")
        (self.root / "VERSION").write_text("0.1.0\n")
        self.git("add", "VERSION")
        self.git("commit", "-m", "feat: initial extension")

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.root, text=True, stderr=subprocess.DEVNULL).strip()

    def commit(self, message):
        self.git("commit", "--allow-empty", "-m", message)

    def test_first_release_uses_base_version(self):
        result = release.plan(self.root, "HEAD")
        self.assertEqual(result["tag"], "v0.1.0")
        self.assertEqual(result["previous_tag"], "")
        self.assertEqual(result["sha"], self.git("rev-parse", "HEAD"))

    def test_history_after_previous_tag_controls_version(self):
        self.git("tag", "-a", "v0.1.0", "-m", "Initial release")
        self.commit("fix: preserve credits")
        self.assertEqual(release.plan(self.root, "HEAD")["version"], "0.1.1")
        self.commit("feat: new playback option")
        result = release.plan(self.root, "HEAD")
        self.assertEqual(result["version"], "0.2.0")
        self.assertEqual(result["previous_tag"], "v0.1.0")

    def test_retry_reuses_tag_and_previous_release(self):
        self.git("tag", "v0.1.0")
        self.commit("fix: retry")
        self.git("tag", "v0.1.1")
        result = release.plan(self.root, "HEAD")
        self.assertEqual(result["version"], "0.1.1")
        self.assertEqual(result["previous_tag"], "v0.1.0")

    def test_unmerged_and_nonrelease_tags_do_not_set_version(self):
        self.git("tag", "v-next")
        self.git("checkout", "-b", "unmerged")
        self.commit("feat!: unrelated")
        self.git("tag", "v99.0.0")
        self.git("checkout", "main")
        self.assertEqual(release.plan(self.root, "HEAD")["version"], "0.1.0")

    def test_existing_tag_is_never_moved_to_another_commit(self):
        self.git("checkout", "-b", "other")
        self.commit("fix: other")
        self.git("tag", "v0.1.0")
        self.git("checkout", "main")
        with self.assertRaisesRegex(ValueError, "another commit"):
            release.plan(self.root, "HEAD")

    def test_stamp_synchronizes_both_bundles_manifest_and_lockfile(self):
        for filename in ("package.json", "package-lock.json", "Extension/Resources/manifest.json", "scripts/generate-project.py"):
            dest = self.root / filename
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / filename, dest)
        release.stamp(self.root, "1.3.5", "42")
        self.assertEqual((self.root / "VERSION").read_text(), "1.3.5\n")
        for filename in ("package.json", "package-lock.json", "Extension/Resources/manifest.json"):
            self.assertEqual(json.loads((self.root / filename).read_text())["version"], "1.3.5")
        lock = json.loads((self.root / "package-lock.json").read_text())
        self.assertEqual(lock["packages"][""]["version"], "1.3.5")
        project = (self.root / "AniSkipSafari.xcodeproj/project.pbxproj").read_text()
        self.assertEqual(project.count("MARKETING_VERSION = 1.3.5;"), 6)
        self.assertEqual(project.count("CURRENT_PROJECT_VERSION = 42;"), 6)

    def test_bad_build_number_does_not_modify_version(self):
        for number in ("0", "-1", "1\ninvalid", "2147483648"):
            with self.assertRaises(ValueError):
                release.stamp(self.root, "0.2.0", number)
        self.assertEqual((self.root / "VERSION").read_text(), "0.1.0\n")


if __name__ == "__main__":
    unittest.main()

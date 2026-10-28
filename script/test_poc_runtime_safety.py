#!/usr/bin/env python3
from pathlib import Path
import re, subprocess, tempfile, unittest

ROOT = Path(__file__).resolve().parents[1]
class RuntimeSafetyTests(unittest.TestCase):
    def test_function_health_failure_invokes_rollback(self):
        source = (ROOT / 'script/deploy_poc_frontend.sh').read_text()
        flags = re.search(r'^set (-[^\n]+)$', source, re.M)[1]
        def probe(flag):
            return subprocess.run(['bash', '-c', f'''set {flag}
on_error() {{ rc=$?; trap - ERR; printf 'ROLLBACK_INVOKED\\n'; exit "$rc"; }}
trap on_error ERR
passive_health() {{ [[ false == true ]]; printf 'MUST_NOT_RUN\\n'; }}
passive_health
printf 'MUST_NOT_ACCEPT\\n'
'''], capture_output=True, text=True)
        actual = probe(flags)
        self.assertNotEqual(actual.returncode, 0)
        self.assertEqual(actual.stdout, 'ROLLBACK_INVOKED\n')
        old = probe('-euo pipefail')
        self.assertNotEqual(old.returncode, 0)
        self.assertNotIn('ROLLBACK_INVOKED', old.stdout)

    def test_public_static_modes_are_normalized(self):
        recipe = (ROOT / 'Dockerfile.qa-frontend').read_text()
        self.assertIn('find /usr/share/nginx/html -type d -exec chmod 755', recipe)
        self.assertIn('find /usr/share/nginx/html -type f -exec chmod 644', recipe)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root / 'static').mkdir(mode=0o700)
            index = root / 'static/index.html'; index.write_text('public fixture'); index.chmod(0o600)
            self.assertFalse(index.stat().st_mode & 0o044, 'negative: protected shell produces unreadable public file')
            command = recipe.split('RUN find ', 1)[1].replace('\\\n', ' ')
            command = 'find ' + command.replace('/usr/share/nginx/html', str(root))
            subprocess.run(['sh', '-c', command], check=True)
            self.assertEqual(index.stat().st_mode & 0o777, 0o644)
            self.assertEqual((root / 'static').stat().st_mode & 0o777, 0o755)

if __name__ == '__main__':
    unittest.main(verbosity=2)

"""Safety and accounting checks for the isolated capacity harness."""
import asyncio
import importlib.util
import json
from pathlib import Path
import tempfile
import subprocess
import sys
import unittest

SOURCE = Path(__file__).resolve().parents[1] / 'load' / 'capacity.py'
spec = importlib.util.spec_from_file_location('capacity', SOURCE)
capacity = importlib.util.module_from_spec(spec)
if SOURCE.exists():
    spec.loader.exec_module(capacity)


class CapacityHarnessTests(unittest.TestCase):
    def test_cli_refusal_explains_guard_without_echoing_input(self):
        result = subprocess.run([sys.executable, '-S', str(SOURCE), 'seed', '--database-url',
            'postgresql://secret-user:secret-password@production.example/production',
            '--fixture', '/private/tmp/unused-capacity-fixture.json'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn('Dedicated local capacity_test role', result.stderr)
        self.assertNotIn('secret-password', result.stderr)
        self.assertNotIn('production.example', result.stderr)

    def test_login_does_not_reuse_another_accounts_cookie(self):
        import httpx
        async def exercise():
            seen = []
            def handle(request):
                seen.append(request.headers.get('cookie', ''))
                return httpx.Response(200, json={'ok': True})
            async with httpx.AsyncClient(base_url='http://127.0.0.1:8099',
                    cookies={'access_token': 'another-account'}, transport=httpx.MockTransport(handle)) as client:
                workload = capacity.Workload(client, {'accounts': []}, 0)
                await workload.request({}, 'POST', '/auth/login', '', body={}, measure=False)
            self.assertEqual(seen, [''])
        asyncio.run(exercise())

    def test_planner_writes_use_and_advance_acknowledged_revision(self):
        import httpx
        async def exercise():
            bodies = []
            def handle(request):
                body = json.loads(request.content)
                bodies.append(body)
                return httpx.Response(200, json={**body, 'revision': len(bodies) + 3})
            user = {'recipe_id': 'synthetic', 'planner_revision': 3, 'token': 'synthetic-token'}
            async with httpx.AsyncClient(base_url='http://127.0.0.1:8099', transport=httpx.MockTransport(handle)) as client:
                workload = capacity.Workload(client, {'accounts': [user]}, 1)
                workload.operations = ['planner_write']
                await workload.operation(0)
                await workload.operation(0)
            self.assertEqual([body.get('expected_revision') for body in bodies], [3, 4])
            self.assertEqual(user['planner_revision'], 5)
            self.assertEqual(user['plan_ack_revision'], 5)
        asyncio.run(exercise())

    def test_planner_revision_contract_requires_revision_on_existing_day(self):
        self.assertTrue(hasattr(capacity, 'planner_revision'), 'planner contract reader required')
        self.assertEqual(capacity.planner_revision([]), 0)
        self.assertEqual(capacity.planner_revision([{'date': capacity.DAY, 'revision': 7}]), 7)
        with self.assertRaises(ValueError):
            capacity.planner_revision([{'date': capacity.DAY}])

    def test_only_literal_loopback_targets(self):
        self.assertTrue(hasattr(capacity, 'guard_target'), 'target guard is required')
        for url in ('http://127.0.0.1:8099', 'http://[::1]:8099'):
            capacity.guard_target(url)
        for url in ('https://chef-world.com', 'http://localhost:8000', 'http://127.0.0.1.evil.test',
                    'http://127.0.0.1@evil.test', 'http://127.0.0.1:80/path',
                    'http://127.0.0.1:8000?secret=x', 'http://2130706433'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                capacity.guard_target(url)

    def test_database_requires_dedicated_role_name_and_port(self):
        self.assertTrue(hasattr(capacity, 'guard_database'), 'database guard is required')
        capacity.guard_database('postgresql+asyncpg://capacity_test@127.0.0.1:55438/cooking_capacity_test')
        for url in ('postgresql://postgres@127.0.0.1:55438/cooking_capacity_test',
                    'postgresql://capacity_test@127.0.0.1:5432/cooking_capacity_test',
                    'postgresql://capacity_test@127.0.0.1:55438/cooking',
                    'postgresql://capacity_test@db.example:55438/cooking_capacity_test',
                    'postgresql://capacity_test@127.0.0.1:55438/cooking_capacity_test?host=prod'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                capacity.guard_database(url)

    def test_dropped_work_and_unexpected_429_fail_thresholds(self):
        self.assertTrue(hasattr(capacity, 'summarize'), 'metric accounting is required')
        ok = [('GET /recipes/page', False, 12.0, 200)] * 1000
        self.assertTrue(capacity.summarize(ok, dropped=0, duration=1)['passed'])
        self.assertFalse(capacity.summarize(ok, dropped=2, duration=1)['passed'])
        self.assertFalse(capacity.summarize(ok + [('GET /recipes/page', False, 10, 429)] * 2, dropped=0, duration=1)['passed'])
        self.assertFalse(capacity.summarize([('GET /recipes/page', False, 500, 200)], 0, 1)['passed'])
        self.assertFalse(capacity.summarize([], 0, 1)['passed'])

    def test_private_fixture_refuses_repository_and_has_no_clobber(self):
        self.assertTrue(hasattr(capacity, 'write_fixture'), 'private fixture writer is required')
        with self.assertRaises(ValueError):
            capacity.write_fixture(SOURCE.parent / 'credentials.json', {'password': 'secret'})
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'fixture.json'
            capacity.write_fixture(path, {'password': 'secret'})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                capacity.write_fixture(path, {'password': 'changed'})

    def test_report_config_allowlist_redacts_credentials(self):
        self.assertTrue(hasattr(capacity, 'safe_config'), 'report allowlist is required')
        result = capacity.safe_config({'replicas': 1, 'database_url': 'secret', 'AUTH_SECRET': 'secret',
                                       'token': 'secret', 'cpu': '1', 'raw_recipe': 'private'})
        self.assertEqual(result, {'replicas': 1, 'cpu': '1'})
        self.assertNotIn('secret', json.dumps(result))

    def test_fixture_validation_rejects_real_identity_and_cross_namespace(self):
        self.assertTrue(hasattr(capacity, 'validate_fixture'), 'synthetic identity validation required')
        import uuid
        namespace = uuid.uuid4()
        accounts = [{'id': str(uuid.uuid5(namespace, f'user:{i}')),
                     'email': f'capacity-{namespace.hex}-{i}@example.com',
                     'recipe_id': capacity.recipe_id(namespace, i, 0), 'recipe_count': 10}
                    for i in range(2)]
        fixture = {'namespace': str(namespace), 'accounts': accounts,
                   'database_url': 'postgresql://capacity_test@127.0.0.1:55438/cooking_capacity_test'}
        capacity.validate_fixture(fixture)
        accounts[0]['email'] = 'real@example.com'
        with self.assertRaises(ValueError):
            capacity.validate_fixture(fixture)

    def test_scheduler_exceptions_cannot_disappear(self):
        async def exercise():
            async def broken(_):
                raise RuntimeError('secret provider body must not be retained')
            result = await capacity.open_arrivals(10, .2, 2, broken)
            self.assertEqual(result['dropped'], 2)
            self.assertEqual(result['completed'], 0)
            self.assertNotIn('secret', json.dumps(result))
        asyncio.run(exercise())

    def test_open_arrivals_count_busy_and_late_iterations(self):
        self.assertTrue(hasattr(capacity, 'open_arrivals'), 'open arrival scheduler is required')
        async def exercise():
            async def slow(_):
                await asyncio.sleep(.1)
            result = await capacity.open_arrivals(100, .12, 1, slow)
            self.assertEqual(result['offered'], 12)
            self.assertEqual(result['completed'] + result['dropped'], 12)
            self.assertGreater(result['dropped'], 0)
        asyncio.run(exercise())


if __name__ == '__main__':
    unittest.main()

"""Private no-email production QA preparation; no live cloud calls."""
import copy
import asyncio
import os
import importlib.util
import json
import io
from urllib.error import HTTPError
from unittest.mock import patch
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1] / 'production-smoke.py'
DIGEST = 'sha256:' + 'a' * 64
TASK = 'arn:aws:ecs:us-east-1:930067562682:task-definition/cooking-backend:47'


def resources():
    task = {'taskDefinition': {'taskDefinitionArn': TASK, 'taskRoleArn': 'arn:aws:iam::930067562682:role/task',
        'executionRoleArn': 'arn:aws:iam::930067562682:role/execution', 'networkMode': 'awsvpc',
        'containerDefinitions': [{'name': 'backend', 'image': '930067562682.dkr.ecr.us-east-1.amazonaws.com/cooking-backend@' + DIGEST,
            'essential': True, 'environment': [{'name': 'AUTH_SECRET', 'value': 'synthetic-private-server-value'}]}]}}
    service = {'failures': [], 'services': [{'taskDefinition': TASK, 'desiredCount': 1,
        'networkConfiguration': {'awsvpcConfiguration': {'subnets': ['subnet-a', 'subnet-b'], 'securityGroups': ['sg-a'], 'assignPublicIp': 'DISABLED'}},
        'capacityProviderStrategy': [{'capacityProvider': 'FARGATE', 'weight': 1}], 'platformVersion': '1.4.0'}]}
    return service, task


class ProductionSmokePreparationTests(unittest.TestCase):
    def module(self):
        self.assertTrue(SOURCE.exists(), 'private production smoke preparer must exist')
        spec = importlib.util.spec_from_file_location('production_smoke', SOURCE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_seed_payload_uses_exact_reviewed_immutable_task_network_and_private_credentials(self):
        module = self.module(); service, task = resources(); fixture = module.new_fixture()
        payload = module.task_request(service, task, DIGEST, fixture, 'seed')
        self.assertEqual(payload['taskDefinition'], TASK)
        self.assertEqual(payload['count'], 1)
        self.assertEqual(payload['networkConfiguration'], {'awsvpcConfiguration': {'subnets': ['subnet-a', 'subnet-b'], 'securityGroups': ['sg-a'], 'assignPublicIp': 'DISABLED'}})
        self.assertEqual(payload['capacityProviderStrategy'], [{'capacityProvider': 'FARGATE', 'weight': 1}])
        self.assertNotIn('launchType', payload)
        self.assertEqual(payload['platformVersion'], '1.4.0')
        override = payload['overrides']['containerOverrides'][0]
        self.assertEqual(override['name'], 'backend')
        self.assertEqual(override['command'][:2], ['python', '-c'])
        self.assertEqual(override['environment'][0]['name'], 'CW_QA_SEED_JSON')
        self.assertEqual(json.loads(override['environment'][0]['value']), fixture)
        self.assertNotIn('synthetic-private-server-value', json.dumps(payload))

    def test_fixture_has_only_unique_synthetic_addresses_and_bounded_random_passwords(self):
        module = self.module(); first = module.new_fixture(); second = module.new_fixture()
        self.assertNotEqual(first['namespace'], second['namespace'])
        self.assertEqual(first['api_base'], 'https://api.chef-world.com')
        self.assertEqual({a['label'] for a in first['accounts']}, {'owner', 'viewer'})
        for account in first['accounts']:
            self.assertEqual(account['email'], f"chefworld-qa-{first['namespace']}-{account['label']}@example.com")
            self.assertGreaterEqual(len(account['password']), 32)
            self.assertLessEqual(len(account['password'].encode()), 72)
        module.validate_fixture(first)

    def test_real_identity_or_nonproduction_target_is_rejected(self):
        module = self.module()
        for change in ('email', 'target', 'password', 'extra'):
            fixture = module.new_fixture()
            if change == 'email': fixture['accounts'][0]['email'] = 'real-person@example.com'
            elif change == 'target': fixture['api_base'] = 'https://another.example'
            elif change == 'password': fixture['accounts'][0]['password'] = 'short'
            else: fixture['accounts'][0]['admin'] = True
            with self.subTest(change=change), self.assertRaises(ValueError): module.validate_fixture(fixture)

    def test_unreviewed_sidecars_entrypoint_revision_and_digest_are_rejected(self):
        module = self.module(); fixture = module.new_fixture()
        for change in ('sidecar', 'entrypoint', 'nonessential', 'revision', 'digest', 'network'):
            service, task = resources(); container = task['taskDefinition']['containerDefinitions'][0]
            if change == 'sidecar': task['taskDefinition']['containerDefinitions'].append({'name': 'worker', 'image': 'worker:latest'})
            elif change == 'entrypoint': container['entryPoint'] = ['sh', '-c']
            elif change == 'nonessential': container['essential'] = False
            elif change == 'revision': service['services'][0]['taskDefinition'] = TASK.replace(':47', ':46')
            elif change == 'digest': container['image'] = container['image'].replace(DIGEST, 'sha256:' + 'b' * 64)
            else: service['services'][0]['networkConfiguration']['awsvpcConfiguration']['securityGroups'] = []
            with self.subTest(change=change), self.assertRaises(ValueError): module.task_request(service, task, DIGEST, fixture, 'seed')

    def test_cli_creates_private_no_clobber_files_without_cloud_execution_or_secret_output(self):
        self.module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); service, task = resources()
            (root / 'service.json').write_text(json.dumps(service)); (root / 'task.json').write_text(json.dumps(task))
            output = root / 'qa'
            command = [sys.executable, str(SOURCE), 'prepare', '--service-file', str(root / 'service.json'), '--task-file', str(root / 'task.json'), '--expected-image-digest', DIGEST, '--output-dir', str(output)]
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            fixture = json.loads((output / 'credentials.json').read_text())
            self.assertEqual(output.stat().st_mode & 0o777, 0o700)
            for path in output.iterdir(): self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            for account in fixture['accounts']:
                self.assertNotIn(account['password'], result.stdout + result.stderr)
                self.assertNotIn(account['email'], result.stdout + result.stderr)
            self.assertNotIn('synthetic-private-server-value', result.stdout + result.stderr)
            retry = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(retry.returncode, 2)
            self.assertEqual(json.loads((output / 'credentials.json').read_text()), fixture)

    def test_qa_credentials_are_never_forwarded_through_redirects(self):
        module = self.module()
        with self.assertRaises(ValueError):
            module.NoRedirect().redirect_request(None, None, 302, 'Moved', {}, 'https://untrusted.example')

    def test_cleanup_fixture_binds_authenticated_ids_to_same_namespace_and_completed_deletions(self):
        module = self.module(); fixture = module.new_fixture()
        result = {'namespace': fixture['namespace'], 'account_ids': {'owner':'2b453d81-9926-4413-8735-c45677f537a1', 'viewer':'22884926-39d2-437c-8389-5b31361d9554'}, 'deleted': ['owner', 'viewer']}
        verified = module.verification_fixture(fixture, result)
        self.assertEqual(verified['account_ids'], result['account_ids'])
        self.assertNotIn('account_ids', fixture)
        for edit in ({'namespace': '84c9f118-0d48-4c01-a999-9d2d76337c00'}, {'deleted': ['owner']}, {'account_ids': {'owner': 'bad', 'viewer': 'bad'}}):
            bad = {**result, **edit}
            with self.assertRaises(ValueError): module.verification_fixture(fixture, bad)

    def test_expected_http_errors_are_parsed_without_losing_response_binding(self):
        module = self.module(); api = module.Api({'email': 'synthetic', 'password': 'synthetic'})
        error = HTTPError('https://api.chef-world.com/users/blocks', 409, 'Conflict', {}, io.BytesIO(b'{"detail":"Account mismatch"}'))
        with patch.object(module, 'urlopen', side_effect=error):
            self.assertEqual(api.request('GET', '/users/blocks', expected=409), {'detail': 'Account mismatch'})

    def test_smoke_cleans_both_generated_accounts_after_midflow_failure(self):
        module = self.module(); fixture = module.new_fixture(); calls = []
        ids = ['2b453d81-9926-4413-8735-c45677f537a1', '22884926-39d2-437c-8389-5b31361d9554']
        class Api:
            def __init__(self, credentials):
                self.credentials = credentials; self.actor = None
            def login(self):
                self.actor = ids[0 if '-owner@' in self.credentials['email'] else 1]
                return self.actor
            def request(self, method, path, body=None, **kwargs):
                calls.append((self.actor, method, path))
                if path == '/recipes/upload-image': raise ValueError('Storage unavailable')
                return {'ok': True}
        result = module.smoke(fixture, api_factory=Api)
        self.assertFalse(result['passed'])
        self.assertEqual(result['failed_stage'], 'owned_upload')
        self.assertEqual(result['deleted'], ['owner', 'viewer'])
        deletions = [row for row in calls if row[1:] == ('DELETE', '/auth/me')]
        self.assertEqual({row[0] for row in deletions}, set(ids))
        self.assertFalse(any('/register' in row[2] for row in calls))

    def test_initial_login_failure_retries_cleanup_for_every_seeded_identity(self):
        module = self.module()
        for failing_label in ('owner', 'viewer'):
            fixture = module.new_fixture(); attempts = {}; deleted = []
            class Api:
                def __init__(self, credentials):
                    self.credentials = credentials; self.actor = None
                    self.label = 'owner' if '-owner@' in credentials['email'] else 'viewer'
                def login(self):
                    attempts[self.label] = attempts.get(self.label, 0) + 1
                    if self.label == failing_label and attempts[self.label] == 1: raise ValueError('Transient login failure')
                    self.actor = '2b453d81-9926-4413-8735-c45677f537a1' if self.label == 'owner' else '22884926-39d2-437c-8389-5b31361d9554'
                    return self.actor
                def request(self, method, path, body=None, **kwargs):
                    if method == 'DELETE': deleted.append(self.label)
                    return {'ok': True}
            with self.subTest(failing_label=failing_label):
                result = module.smoke(fixture, api_factory=Api)
                self.assertFalse(result['passed'])
                self.assertEqual(result['failed_stage'], 'login')
                self.assertEqual(set(result['deleted']), {'owner', 'viewer'})
                self.assertEqual(set(deleted), {'owner', 'viewer'})
                self.assertEqual(set(result['account_ids']), {'owner', 'viewer'})

    def test_unrecoverable_login_marks_all_residual_seeded_labels_for_cleanup(self):
        module = self.module(); fixture = module.new_fixture(); attempts = {}
        class Api:
            def __init__(self, credentials):
                self.credentials = credentials; self.actor = None
                self.label = 'owner' if '-owner@' in credentials['email'] else 'viewer'
            def login(self):
                attempts[self.label] = attempts.get(self.label, 0) + 1
                raise ValueError('Persistent login failure')
        result = module.smoke(fixture, api_factory=Api)
        self.assertFalse(result['passed'])
        self.assertEqual(set(result['cleanup_failed']), {'owner', 'viewer'})
        self.assertEqual(result['deleted'], [])
        self.assertEqual(attempts, {'owner': 2, 'viewer': 1})

    @unittest.skipUnless(os.environ.get('TEST_DATABASE_URL'), 'Requires task-owned disposable PostgreSQL')
    def test_static_seed_creates_verified_local_identities_without_email_or_action_tokens(self):
        module = self.module(); fixture = module.new_fixture()
        environment = {**os.environ, 'CW_QA_SEED_JSON': json.dumps(fixture), 'APP_ENV': 'test',
            'DATABASE_URL': os.environ['TEST_DATABASE_URL'], 'DATABASE_SSL': 'false',
            'AUTH_SECRET': 'production-smoke-local-test-only-secret-123456'}
        # Fail any attempted account-email dispatch; execute the actual task source.
        guard = "from app.services import account_email\n" + "def forbidden_email(*args, **kwargs): raise AssertionError('No-email QA contract')\n" + "account_email.deliver_account_email = forbidden_email\n"
        seed = subprocess.run([sys.executable, '-c', guard + module.SEED_SOURCE],
            cwd=SOURCE.parents[1] / 'backend', env=environment, capture_output=True, text=True)
        self.assertEqual(seed.returncode, 0, seed.stdout + seed.stderr)
        self.assertIn('no email dispatched', seed.stdout)
        # Read and clean exactly this random namespace using real repository rows.
        code = r'''import asyncio, json, os
from sqlalchemy import select, delete
from app.db import session as db
from app.db.models import UserModel, AuthIdentityModel
from app.db.account_models import AccountActionTokenModel
from app.core.security import verify_password
async def main():
    fixture = json.loads(os.environ['CW_QA_SEED_JSON']); db.init_engine()
    try:
        async with db.async_session_maker.begin() as session:
            rows = list((await session.execute(select(UserModel).where(UserModel.email.in_([x['email'] for x in fixture['accounts']])))).scalars())
            assert len(rows) == 2
            ids = [x.id for x in rows]
            for user in rows:
                assert user.email_verified and user.email_verification_required
                identity = (await session.execute(select(AuthIdentityModel).where(AuthIdentityModel.user_id == user.id))).scalar_one()
                account = next(x for x in fixture['accounts'] if x['email'] == user.email)
                assert identity.provider == 'local' and verify_password(account['password'], identity.password_hash)
            assert (await session.execute(select(AccountActionTokenModel.token_hash).where(AccountActionTokenModel.user_id.in_(ids)))).first() is None
            await session.execute(delete(UserModel).where(UserModel.id.in_(ids)))
    finally: await db.dispose_engine()
asyncio.run(main())
print('Disposable QA identity and no-email repository integration verified')
'''
        verified = subprocess.run([sys.executable, '-c', code], cwd=SOURCE.parents[1] / 'backend',
            env=environment, capture_output=True, text=True)
        self.assertEqual(verified.returncode, 0, verified.stdout + verified.stderr)
        for account in fixture['accounts']:
            self.assertNotIn(account['password'], seed.stdout + seed.stderr + verified.stdout + verified.stderr)

    def test_restored_photo_smoke_verifies_detachment_and_cleans_owner_before_viewer(self):
        module = self.module()
        owner_id, viewer_id = '2b453d81-9926-4413-8735-c45677f537a1', '22884926-39d2-437c-8389-5b31361d9554'
        for unavailable in (False, True):
            fixture = module.new_fixture(); fixture['accounts'].reverse()
            state = {'deleted': [], 'recipe': None}
            image = f'https://qa.example/recipes/{owner_id}/qa.png'
            class FakeApi:
                def __init__(self, credentials):
                    self.credentials = credentials; self.actor = None
                    self.label = 'owner' if '-owner@' in credentials['email'] else 'viewer'
                def login(self):
                    self.actor = owner_id if self.label == 'owner' else viewer_id
                    return self.actor
                def request(self, method, path, body=None, **kwargs):
                    if path == '/recipes/upload-image': return {'file_url': image}
                    if path == '/recipes' and method == 'POST':
                        state['recipe'] = body; return body
                    if path.endswith('/copy'): return {**state['recipe'], 'id': 'qa-copy'}
                    if path == f'/users/{owner_id}/recipes/page?limit=20': return {'items': [state['recipe']]}
                    if path.startswith(f'/users/{owner_id}/recipes/'): return state['recipe']
                    if path == '/auth/me' and method == 'DELETE' and kwargs.get('expected', 200) == 200:
                        state['deleted'].append(self.label)
                    if path == '/recipes/qa-copy':
                        if unavailable or 'viewer' in state['deleted']: raise ValueError('Detachment read unavailable')
                        return {'id':'qa-copy', 'title':'Disposable Chef World QA recipe', 'steps':[{'text':'Pour water.'}]}
                    return {'ok': True}
            with self.subTest(detachment_read_unavailable=unavailable):
                result = module.smoke(fixture, api_factory=FakeApi)
                self.assertEqual(state['deleted'], ['owner', 'viewer'])
                self.assertEqual(set(result['deleted']), {'owner', 'viewer'})
                self.assertEqual(result['passed'], not unavailable)
                if unavailable: self.assertEqual(result['failed_stage'], 'deleted_owner_media_detachment')

    def test_verification_payload_is_read_only_and_scoped_to_smoke_account_ids(self):
        module = self.module(); fixture = module.new_fixture(); service, task = resources()
        fixture['account_ids'] = {'owner': '2b453d81-9926-4413-8735-c45677f537a1', 'viewer': '22884926-39d2-437c-8389-5b31361d9554'}
        payload = module.task_request(service, task, DIGEST, fixture, 'verify')
        self.assertEqual(payload['overrides']['containerOverrides'][0]['environment'][0]['name'], 'CW_QA_CHECK_JSON')
        check = json.loads(payload['overrides']['containerOverrides'][0]['environment'][0]['value'])
        self.assertEqual(check['account_ids'], fixture['account_ids'])
        self.assertNotIn('password', json.dumps(check))


if __name__ == '__main__': unittest.main()

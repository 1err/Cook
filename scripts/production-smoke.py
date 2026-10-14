#!/usr/bin/env python3
"""Prepare private one-off QA task inputs; execute API smoke only on explicit command.

Never registers accounts through HTTP, sends email, grants admin, calls AI, or
executes AWS. Root operators launch the reviewed ECS payloads and verify exit0.
"""
import argparse
import base64
import copy
import json
import os
from pathlib import Path
import re
import secrets
import sys
import uuid
from urllib.error import HTTPError
from urllib.request import Request, HTTPRedirectHandler, build_opener

API_BASE = 'https://api.chef-world.com'
ACCOUNT = '930067562682'
REGION = 'us-east-1'
LABELS = ('owner', 'viewer')


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        raise ValueError('QA API redirects are refused')


urlopen = build_opener(NoRedirect()).open

SEED_SOURCE = r'''
import asyncio, json, os, sys, uuid
async def main():
    from app.core.security import hash_password
    from app.db import session as db, repo_auth
    data = json.loads(os.environ['CW_QA_SEED_JSON'])
    namespace = str(uuid.UUID(data['namespace']))
    assert data['namespace'] == namespace and data['api_base'] == 'https://api.chef-world.com'
    assert {x['label'] for x in data['accounts']} == {'owner', 'viewer'} and len(data['accounts']) == 2
    for row in data['accounts']:
        assert set(row) == {'label', 'email', 'password'}
        assert row['email'] == 'chefworld-qa-' + namespace + '-' + row['label'] + '@example.com'
        assert isinstance(row['password'], str) and 32 <= len(row['password'].encode()) <= 72
    db.init_engine()
    try:
        async with db.async_session_maker.begin() as session:
            # Refuse collisions/reuse. One transaction commits both identities.
            for row in data['accounts']:
                if await repo_auth.get_user_by_email(session, row['email']) is not None:
                    raise ValueError('QA namespace already exists')
            for row in data['accounts']:
                user = await repo_auth.create_user(session, row['email'], email_verification_required=True)
                user.email_verified = True
                await repo_auth.create_identity(session, user.id, provider='local',
                    provider_user_id=row['email'], password_hash=hash_password(row['password']))
    finally:
        await db.dispose_engine()
try:
    asyncio.run(main())
except BaseException:
    print('QA seed failed', file=sys.stderr)
    sys.exit(1)
print('QA seed committed: 2 disposable verified identities; no email dispatched')
'''

VERIFY_SOURCE = r'''
import asyncio, json, os, sys, uuid
async def main():
    from sqlalchemy import select
    from app.core.config import settings
    from app.db import session as db
    from app.db.models import UserModel, AccountMediaCleanupModel
    from pathlib import Path
    from botocore.config import Config
    import boto3
    data = json.loads(os.environ['CW_QA_CHECK_JSON'])
    assert str(uuid.UUID(data['namespace'])) == data['namespace']
    assert set(data['account_ids']) == {'owner', 'viewer'}
    ids = [uuid.UUID(data['account_ids'][label]) for label in ('owner', 'viewer')]
    assert len(set(ids)) == 2
    db.init_engine()
    try:
        async with db.async_session_maker() as session:
            assert (await session.execute(select(UserModel.id).where(UserModel.id.in_(ids)))).first() is None
            assert (await session.execute(select(AccountMediaCleanupModel.account_id).where(AccountMediaCleanupModel.account_id.in_(ids)))).first() is None
    finally:
        await db.dispose_engine()
    assert settings.S3_BUCKET_NAME and settings.AWS_REGION
    client = boto3.client('s3', region_name=settings.AWS_REGION,
        config=Config(connect_timeout=5, read_timeout=15, retries={'total_max_attempts':1}))
    try:
        for account_id in ids:
            prefix = 'recipes/' + str(account_id) + '/'
            # Both versions and current keys must be absent; never delete here.
            for page in client.get_paginator('list_object_versions').paginate(Bucket=settings.S3_BUCKET_NAME, Prefix=prefix):
                assert not page.get('Versions') and not page.get('DeleteMarkers')
            for page in client.get_paginator('list_objects_v2').paginate(Bucket=settings.S3_BUCKET_NAME, Prefix=prefix):
                assert not page.get('Contents')
    finally:
        client.close()
try:
    asyncio.run(main())
except BaseException:
    print('QA cleanup verification failed or is still pending', file=sys.stderr)
    sys.exit(1)
print('QA cleanup verified: accounts absent; cleanup intents drained; owned S3 prefixes empty')
'''


def new_fixture():
    namespace = str(uuid.uuid4())
    return {'version': 1, 'namespace': namespace, 'api_base': API_BASE,
        'accounts': [{'label': label, 'email': f'chefworld-qa-{namespace}-{label}@example.com',
                      'password': secrets.token_urlsafe(32)} for label in LABELS]}


def validate_fixture(data):
    if not isinstance(data, dict) or data.get('version') != 1 or data.get('api_base') != API_BASE:
        raise ValueError('Invalid QA fixture')
    try:
        namespace = str(uuid.UUID(data['namespace']))
    except (KeyError, TypeError, ValueError, AttributeError):
        raise ValueError('Invalid QA namespace') from None
    if data['namespace'] != namespace or not isinstance(data.get('accounts'), list) or len(data['accounts']) != 2:
        raise ValueError('Invalid QA fixture')
    if {row.get('label') for row in data['accounts'] if isinstance(row, dict)} != set(LABELS):
        raise ValueError('Invalid QA account labels')
    for row in data['accounts']:
        if set(row) != {'label', 'email', 'password'} or row['email'] != f"chefworld-qa-{namespace}-{row['label']}@example.com":
            raise ValueError('Only generated disposable example.com identities are allowed')
        if not isinstance(row['password'], str) or not 32 <= len(row['password'].encode()) <= 72:
            raise ValueError('Invalid bounded QA password')
    if 'account_ids' in data:
        ids = data['account_ids']
        if not isinstance(ids, dict) or set(ids) != set(LABELS):
            raise ValueError('Invalid verified QA account IDs')
        try:
            values = [str(uuid.UUID(ids[label])) for label in LABELS]
        except (ValueError, TypeError, AttributeError):
            raise ValueError('Invalid verified QA account IDs') from None
        if len(set(values)) != 2 or any(ids[label] != values[i] for i, label in enumerate(LABELS)):
            raise ValueError('Invalid verified QA account IDs')


def task_request(service_response, task_response, expected_digest, fixture, operation):
    validate_fixture(fixture)
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', expected_digest):
        raise ValueError('A verified immutable release image digest is required')
    if operation not in ('seed', 'verify'):
        raise ValueError('Unsupported QA operation')
    services = service_response.get('services', [])
    if service_response.get('failures') or len(services) != 1 or services[0].get('desiredCount', 0) < 1:
        raise ValueError('Expected one active ECS service')
    service = services[0]
    task = task_response.get('taskDefinition', {})
    arn = task.get('taskDefinitionArn', '')
    if not re.fullmatch(r'arn:aws:ecs:us-east-1:930067562682:task-definition/cooking-backend:[1-9][0-9]*', arn) or service.get('taskDefinition') != arn:
        raise ValueError('The reviewed task must match the active service release')
    containers = task.get('containerDefinitions', [])
    if len(containers) != 1 or containers[0].get('name') != 'backend' or containers[0].get('essential') is False or containers[0].get('entryPoint'):
        raise ValueError('QA one-off requires one essential backend with no custom entrypoint or sidecars')
    if containers[0].get('image') != f'{ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com/cooking-backend@{expected_digest}':
        raise ValueError('Reviewed task image differs from the expected release digest')
    network = service.get('networkConfiguration', {})
    awsvpc = network.get('awsvpcConfiguration', {})
    if task.get('networkMode') != 'awsvpc' or not awsvpc.get('subnets') or not awsvpc.get('securityGroups'):
        raise ValueError('Reviewed private service network is required')
    for key in ('taskRoleArn', 'executionRoleArn'):
        if not task.get(key, '').startswith(f'arn:aws:iam::{ACCOUNT}:role/'):
            raise ValueError('Reviewed same-account task and execution roles are required')
    if operation == 'seed':
        private_data = {key: fixture[key] for key in ('version', 'namespace', 'api_base', 'accounts')}
        source, name = SEED_SOURCE, 'CW_QA_SEED_JSON'
    else:
        if 'account_ids' not in fixture:
            raise ValueError('Cleanup verification requires account IDs established by authenticated QA login')
        private_data = {'namespace': fixture['namespace'], 'account_ids': fixture['account_ids']}
        source, name = VERIFY_SOURCE, 'CW_QA_CHECK_JSON'
    payload = {'cluster': 'cooking-cluster', 'taskDefinition': arn, 'count': 1,
        'networkConfiguration': copy.deepcopy(network),
        'overrides': {'containerOverrides': [{'name': 'backend', 'command': ['python', '-c', source],
            'environment': [{'name': name, 'value': json.dumps(private_data)}]}]}}
    if service.get('capacityProviderStrategy'):
        payload['capacityProviderStrategy'] = copy.deepcopy(service['capacityProviderStrategy'])
    else:
        payload['launchType'] = service.get('launchType') or 'FARGATE'
    if service.get('platformVersion'):
        payload['platformVersion'] = service['platformVersion']
    return payload


def private_file(path, data):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as output:
        json.dump(data, output, indent=2); output.write('\n')


def read_private_fixture(path):
    path = Path(path)
    if path.is_symlink() or path.stat().st_mode & 0o077:
        raise ValueError('QA credentials must be a private regular file')
    data = json.loads(path.read_text()); validate_fixture(data)
    return data


def verification_fixture(fixture, result):
    validate_fixture(fixture)
    if result.get('namespace') != fixture['namespace'] or set(result.get('deleted', [])) != set(LABELS):
        raise ValueError('Cleanup proof must match the QA namespace and completed account deletions')
    verified = copy.deepcopy(fixture)
    verified['account_ids'] = result.get('account_ids')
    validate_fixture(verified)
    return verified


class Api:
    def __init__(self, credentials):
        self.credentials = credentials; self.actor = None; self.token = None

    def request(self, method, path, body=None, expected=200, raw=None, content_type=None, actor=None):
        if not path.startswith('/') or path.startswith('//'):
            raise ValueError('Invalid API path')
        headers = {'Accept': 'application/json'}
        if self.token:
            headers['Authorization'] = 'Bearer ' + self.token
            headers['X-Chef-World-Account-ID'] = actor or self.actor
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        if data is not None: headers['Content-Type'] = content_type or 'application/json'
        try:
            response = urlopen(Request(API_BASE + path, data=data, headers=headers, method=method), timeout=30)
        except HTTPError as error:
            response = error
        with response:
            status = response.status; result = response.read()
        if status != expected:
            raise ValueError(f'QA endpoint {method} {path.split("?")[0]} returned unexpected status {status}')
        return json.loads(result) if result else None

    def login(self):
        result = self.request('POST', '/auth/login', self.credentials)
        if result.get('email') != self.credentials['email'] or not result.get('email_verified'):
            raise ValueError('QA login did not establish the generated verified identity')
        self.actor = str(uuid.UUID(result['id'])); self.token = result['access_token']
        return self.actor


def smoke(fixture, api_factory=Api):
    validate_fixture(fixture)
    clients = {row['label']: api_factory({'email': row['email'], 'password': row['password']}) for row in fixture['accounts']}
    stage = 'login'; result = {'version': 1, 'namespace': fixture['namespace'], 'checks': [], 'deleted': [], 'account_ids': {}}
    try:
        for label, client in clients.items(): result['account_ids'][label] = client.login()
        fixture['account_ids'] = result['account_ids']; validate_fixture(fixture)
        owner, viewer = clients['owner'], clients['viewer']
        stage = 'actor_guard'
        viewer.request('GET', '/recipes/page', expected=409, actor=owner.actor)
        for client in clients.values(): client.request('POST', '/auth/library-visibility', {'is_public': True})
        stage = 'owned_upload'
        boundary = 'ChefWorldQA' + uuid.uuid4().hex
        png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cK1sAAAAASUVORK5CYII=')
        multipart = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="qa.png"\r\nContent-Type: image/png\r\n\r\n'.encode() + png + f'\r\n--{boundary}--\r\n'.encode())
        uploaded = owner.request('POST', '/recipes/upload-image', raw=multipart, content_type='multipart/form-data; boundary=' + boundary)
        image_url = uploaded['file_url']
        if f'/recipes/{owner.actor}/' not in image_url:
            raise ValueError('QA upload is not linked to the authenticated owner')
        recipe_id = 'qa_' + fixture['namespace']
        recipe = {'id': recipe_id, 'title': 'Disposable Chef World QA recipe', 'description': 'Synthetic deployment verification; safe to remove.',
            'ingredients': [{'name': 'Water', 'quantity': '1 cup'}], 'steps': [{'text': 'Pour water into a cup.', 'image_url': image_url}], 'thumbnail_url': image_url}
        stage = 'shared_photos'
        owner.request('POST', '/recipes', recipe)
        shared = viewer.request('GET', f'/users/{owner.actor}/recipes/{recipe_id}')
        if shared.get('thumbnail_url') != image_url or shared.get('steps', [{}])[0].get('image_url') != image_url:
            raise ValueError('Original shared photo visibility was not restored')
        page = viewer.request('GET', f'/users/{owner.actor}/recipes/page?limit=20')
        matched = [row for row in page.get('items', []) if row.get('id') == recipe_id]
        if len(matched) != 1 or matched[0].get('thumbnail_url') != image_url:
            raise ValueError('Original shared paged photos were not restored')
        stage = 'photo_copy'
        copied = viewer.request('POST', f'/users/{owner.actor}/recipes/{recipe_id}/copy')
        if copied.get('thumbnail_url') != image_url or copied.get('steps', [{}])[0].get('image_url') != image_url:
            raise ValueError('Shared QA copy lost its photos')
        result['copied_recipe_id'] = copied['id']
        stage = 'retired_safeguards'
        for path in ['/users/blocks', '/admin/content-reports', '/admin/media-reviews']:
            viewer.request('GET', path, expected=404)
        stage = 'password_deletion'
        owner.request('DELETE', '/auth/me', {'password': 'known-incorrect-qa-password'}, expected=403)
        result['checks'] = ['verified-login', 'actor-409', 'owned-upload', 'shared-photos-visible', 'paged-shared-photos-visible', 'copies-include-photos', 'report-block-review-routes-retired', 'wrong-password-403']
        result['media_url'] = image_url
    except Exception:
        result['failed_stage'] = stage
    finally:
        for label in LABELS:
            client = clients[label]
            try:
                # Every identity was seeded even if the initial login loop failed.
                # One bounded retry obtains a cleanup session for each known QA email.
                if not client.actor:
                    client.login()
                result['account_ids'][label] = client.actor
                client.request('DELETE', '/auth/me', {'password': client.credentials['password']})
                client.request('GET', '/auth/me', expected=401)
                result['deleted'].append(label)
                if label == 'owner' and result.get('copied_recipe_id'):
                    try:
                        preserved = clients['viewer'].request('GET', '/recipes/' + result['copied_recipe_id'])
                        if preserved.get('thumbnail_url') or any(step.get('image_url') for step in preserved.get('steps', [])) or preserved.get('title') != 'Disposable Chef World QA recipe':
                            raise ValueError('Copied recipe retains deleted owner media or lost its text')
                        result['checks'].append('copied-media-detached-after-owner-deletion')
                    except Exception:
                        result['failed_stage'] = 'deleted_owner_media_detachment'
            except Exception:
                result.setdefault('cleanup_failed', []).append(label)
    result['passed'] = 'failed_stage' not in result and not result.get('cleanup_failed') and set(result['deleted']) == set(LABELS)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ('prepare', 'prepare-verification'):
        command = commands.add_parser(name)
        command.add_argument('--service-file', required=True); command.add_argument('--task-file', required=True)
        command.add_argument('--expected-image-digest', required=True); command.add_argument('--output-dir', required=True)
        if name == 'prepare-verification':
            command.add_argument('--credentials', required=True)
            command.add_argument('--smoke-result', required=True)
    command = commands.add_parser('smoke')
    command.add_argument('--credentials', required=True); command.add_argument('--result-file', required=True)
    command.add_argument('--execute', action='store_true', help='Explicitly mutate only disposable generated QA accounts through the production API')
    args = parser.parse_args()
    try:
        if args.command == 'smoke':
            if not args.execute: raise ValueError('Smoke requires the explicit --execute flag')
            fixture = read_private_fixture(args.credentials)
            if Path(args.result_file).exists(): raise ValueError('Result file already exists')
            result = smoke(fixture)
            private_file(Path(args.result_file), result)
            # Persist discovered IDs without credentials to a separate private result.
            print('QA API smoke passed; cleanup verification still required' if result['passed'] else 'QA API smoke failed; inspect private result and clean only disposable QA accounts')
            return 0 if result['passed'] else 1
        service = json.loads(Path(args.service_file).read_text()); task = json.loads(Path(args.task_file).read_text())
        fixture = new_fixture() if args.command == 'prepare' else verification_fixture(
            read_private_fixture(args.credentials), json.loads(Path(args.smoke_result).read_text()))
        operation = 'seed' if args.command == 'prepare' else 'verify'
        payload = task_request(service, task, args.expected_image_digest, fixture, operation)
        output = Path(args.output_dir).resolve()
        repo = Path(__file__).resolve().parents[1]
        if output.is_relative_to(repo): raise ValueError('QA private output must be outside the repository')
        output.mkdir(mode=0o700, parents=False, exist_ok=False)
        private_file(output / 'run-task.json', payload)
        if operation == 'seed': private_file(output / 'credentials.json', fixture)
        print('Private QA task inputs prepared; no cloud operation was executed')
        return 0
    except Exception:
        print('QA preparation refused or failed; private input values were not printed', file=sys.stderr)
        return 2


if __name__ == '__main__': raise SystemExit(main())

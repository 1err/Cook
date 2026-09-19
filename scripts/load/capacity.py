#!/usr/bin/env python3
"""Bounded local-only capacity qualification; never invokes external providers."""
from __future__ import annotations

import argparse
import asyncio
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import random
import re
import secrets
import subprocess
import sys
import time
from urllib.parse import urlsplit
import uuid

ROOT = Path(__file__).resolve().parents[2]
DAY = '2026-09-18'
LOOPBACK = {'127.0.0.1', '::1'}
CONFIG_KEYS = {'cpu', 'memory_mb', 'replicas', 'database_version', 'database_connection_limit',
               'database_pool_size', 'database_pool_overflow', 'region', 'image_digest',
               'frontend_revision', 'server_revision', 'abuse_limits_enabled', 'monthly_budget_usd'}
MIX = [('library', 20), ('catalog', 20), ('detail', 20), ('planner_read', 7),
       ('planner_write', 8), ('cooking_read', 8), ('cooking_write', 7),
       ('shopping', 5), ('cached_store', 5)]


class HarnessRefusal(ValueError):
    """An intentional refusal with a static, credential-free explanation."""


def guard_target(value):
    u = urlsplit(value)
    if (u.scheme != 'http' or u.hostname not in LOOPBACK or u.username or u.password
            or u.path not in ('', '/') or u.query or u.fragment or not u.port or u.port < 1024):
        raise HarnessRefusal('Only explicit HTTP loopback literals on unprivileged ports are allowed')
    return value.rstrip('/')


def guard_database(value):
    u = urlsplit(value)
    if (u.scheme not in ('postgresql', 'postgresql+asyncpg') or u.hostname not in LOOPBACK
            or u.username != 'capacity_test' or u.path != '/cooking_capacity_test'
            or not u.port or u.port < 1024 or u.port == 5432 or u.query or u.fragment):
        raise HarnessRefusal('Dedicated local capacity_test role and cooking_capacity_test database required')
    return value.replace('postgresql+asyncpg://', 'postgresql://', 1)


def fixture_path(path):
    path = Path(path).expanduser().absolute()
    # Credentials belong in a private temporary directory, never a checkout or symlink.
    if path.is_symlink() or not path.parent.is_dir():
        raise HarnessRefusal('Fixture parent must already exist and fixture must not be a symlink')
    resolved = path.resolve()
    temp_roots = [Path('/tmp').resolve(), Path(os.environ.get('TMPDIR', '/tmp')).resolve()]
    if not any(resolved.is_relative_to(p) for p in temp_roots):
        raise HarnessRefusal('Fixture credentials must be outside Git, in a temporary directory')
    if any((p / '.git').exists() for p in resolved.parents):
        raise HarnessRefusal('Fixture credentials cannot be inside a Git checkout')
    return resolved


def write_fixture(path, data):
    path = fixture_path(path)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(data, stream)


def safe_config(config):
    return {k: v for k, v in config.items() if k in CONFIG_KEYS and isinstance(v, (str, int, float, bool, type(None)))}


def percentile(values, q):
    values = sorted(values)
    return round(values[max(0, math.ceil(len(values) * q) - 1)], 3) if values else None


def summarize(samples, dropped, duration):
    routes = defaultdict(list)
    for route, write, latency, status in samples:
        routes[(route, write)].append((latency, status))
    result = {}
    unexpected = sum(not 200 <= s[3] < 300 for s in samples)
    offered = len(samples) + dropped
    rate = (unexpected + dropped) / offered if offered else 1.0
    for (route, write), values in sorted(routes.items()):
        latencies = [v[0] for v in values]
        p95, p99 = percentile(latencies, .95), percentile(latencies, .99)
        result[route] = {'count': len(values), 'operation': 'write' if write else 'read',
                         'p50_ms': percentile(latencies, .5), 'p95_ms': p95, 'p99_ms': p99,
                         'status_counts': dict(Counter(str(v[1]) for v in values)),
                         'passed_latency': p95 < (1000 if write else 500) and p99 < 2000}
    return {'offered': offered, 'completed': len(samples), 'dropped': dropped,
            'unexpected_failures': unexpected, 'unexpected_failure_rate_including_drops': rate,
            'achieved_rps': round(len(samples) / max(duration, .000001), 3),
            'read_count': sum(not s[1] for s in samples), 'write_count': sum(s[1] for s in samples),
            'routes': result, 'passed': bool(samples) and rate < .001 and all(v['passed_latency'] for v in result.values())}


async def open_arrivals(rate, duration, concurrency, operation):
    """No catch-up bursts: late and resource-limited scheduled arrivals count as drops."""
    total = math.floor(rate * duration)
    started = time.monotonic()
    pending = set()
    dropped = completed = 0
    async def execute(index):
        nonlocal completed, dropped
        try:
            await operation(index)
        except Exception:
            # A failed generator operation is still offered work, never a vanished sample.
            dropped += 1
        else:
            completed += 1
    for index in range(total):
        due = started + index / rate
        await asyncio.sleep(max(0, due - time.monotonic()))
        if time.monotonic() - due > 1 / rate or len(pending) >= concurrency:
            dropped += 1
            continue
        task = asyncio.create_task(execute(index))
        pending.add(task)
        task.add_done_callback(pending.discard)
    if pending:
        await asyncio.gather(*pending)
    await asyncio.sleep(max(0, started + duration - time.monotonic()))
    return {'offered': total, 'completed': completed, 'dropped': dropped,
            'duration_seconds': time.monotonic() - started}


def validate_fixture(fixture):
    guard_database(fixture['database_url'])
    namespace = uuid.UUID(fixture['namespace'])
    if not 2 <= len(fixture['accounts']) <= 10000:
        raise HarnessRefusal('Fixture account bounds violated')
    for index, user in enumerate(fixture['accounts']):
        if (user['id'] != str(uuid.uuid5(namespace, f'user:{index}'))
                or user['email'] != f'capacity-{namespace.hex}-{index}@example.com'
                or user['recipe_id'] != recipe_id(namespace, index, 0)):
            raise HarnessRefusal('Fixture identities are not owned by this seed namespace')


def recipe_id(namespace, index, recipe):
    return str(uuid.uuid5(namespace, f'recipe:{index}:{recipe}'))


async def seed(args):
    import asyncpg
    import bcrypt
    dsn = guard_database(args.database_url)
    fixture_path(args.fixture)
    if Path(args.fixture).exists():
        raise HarnessRefusal('Fixture already exists; reuse it, or select a new namespace and file')
    if not 2 <= args.accounts <= 10000 or not 1 <= args.catalog <= 10000:
        raise HarnessRefusal('Seed bounds: 2..10000 accounts, 1..10000 catalog recipes')
    sizes = [int(v) for v in args.library_sizes.split(',')]
    if not sizes or any(s not in (10, 100, 1000, 10000) for s in sizes):
        raise HarnessRefusal('Library sizes must be chosen from 10,100,1000,10000')
    namespace = uuid.uuid4()
    password = secrets.token_urlsafe(24)
    password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    fixture = {'schema_version': 1, 'namespace': str(namespace), 'database_url': args.database_url,
               'password': password, 'accounts': [], 'catalog_count': args.catalog, 'library_sizes': sizes,
               'cache_queries': [f'capacity-{namespace.hex}-rice', f'capacity-{namespace.hex}-onion']}
    connection = await asyncpg.connect(dsn, timeout=10, command_timeout=60)
    try:
        identity = await connection.fetchrow('SELECT current_database() AS db, current_user AS role')
        if dict(identity) != {'db': 'cooking_capacity_test', 'role': 'capacity_test'}:
            raise HarnessRefusal('Database identity mismatch')
        # A dedicated DB must never contain non-test accounts, even if its name was changed.
        foreign = await connection.fetchval("SELECT count(*) FROM users WHERE email NOT LIKE 'capacity-%@example.com'")
        if foreign:
            raise HarnessRefusal('Database contains non-synthetic users; refusing to seed')
        async with connection.transaction():
            for index in range(args.accounts):
                owner = uuid.uuid5(namespace, f'user:{index}')
                email = f'capacity-{namespace.hex}-{index}@example.com'
                size = sizes[index] if index < len(sizes) else 10
                fixture['accounts'].append({'id': str(owner), 'email': email, 'recipe_count': size,
                                            'recipe_id': recipe_id(namespace, index, 0)})
                await connection.execute('INSERT INTO users(id,email,is_library_public) VALUES($1,$2,false)', owner, email)
                await connection.execute('INSERT INTO auth_identities(id,user_id,provider,provider_user_id,password_hash) VALUES($1,$2,\'local\',$3,$4)', uuid.uuid5(namespace, f'auth:{index}'), owner, email, password_hash)
                rows = []
                for j in range(size + (args.catalog if index == 0 else 0)):
                    public = j >= size
                    rid = recipe_id(namespace, index, j)
                    ingredients = json.dumps([{'name': name, 'quantity': f'{1 + (j % 3)} {unit}'} for name, unit in [('rice','cups'), ('chicken','g'), ('onion','pieces'), ('carrot','pieces'), ('oil','tbsp'), ('salt','tsp'), ('garlic','cloves'), ('pepper','tsp')]])
                    steps = json.dumps([{'id': str(uuid.uuid5(namespace, f'step:{index}:{j}:{k}')), 'text': f'{verb} the ingredients carefully for this synthetic recipe.', 'duration_seconds': 60 + k * 30, 'duration_source': 'stated', 'attention_type': 'hands_on', 'action_type': 'prep'} for k, verb in enumerate(('Prepare','Chop','Mix','Cook','Rest','Serve'))])
                    rows.append((rid, owner, f'{"Catalog" if public else "Recipe"} {j:05d} variant {index % 19}', ingredients, steps, public,
                                 json.dumps(['quick_dinner'] if j % 2 else ['vegetarian']), 'Synthetic capacity recipe. ' * 12))
                    if len(rows) == 500:
                        await insert_recipes(connection, rows)
                        rows.clear()
                if rows:
                    await insert_recipes(connection, rows)
                await connection.execute('INSERT INTO meal_plan(user_id,date,recipe_ids) VALUES($1,$2,$3)', owner, DAY,
                                         json.dumps({'breakfast': [], 'lunch': [], 'dinner': [recipe_id(namespace, index, 0)]}))
            version_source = (ROOT / 'backend/app/services/store_product_service.py').read_text()
            version = re.search(r'^CACHE_VERSION = "([^"\n]+)"', version_source, re.M).group(1)
            for query in fixture['cache_queries']:
                products = json.dumps([{'name': 'Synthetic capacity product', 'price': '$1.00', 'image': '',
                                        'url': 'https://www.sayweee.com/en/product/synthetic-capacity/1'}])
                await connection.execute("INSERT INTO cached_store_products(query,store,language,cache_version,data) VALUES($1,'weee','en',$2,$3::jsonb)", query, version, products)
        fixture['recipe_count'] = sum(a['recipe_count'] for a in fixture['accounts']) + args.catalog
        write_fixture(args.fixture, fixture)
    finally:
        await connection.close()
    print(json.dumps({'seeded_accounts': args.accounts, 'seeded_recipes': fixture['recipe_count'],
                      'fixture': str(Path(args.fixture).resolve()), 'namespace': str(namespace)}))


async def insert_recipes(connection, rows):
    await connection.executemany('INSERT INTO recipes(id,user_id,title,ingredients,steps,is_public_catalog,library_tags,description,tips,equipment,total_time_minutes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,\'[]\',\'["pan","knife"]\',25)', rows)


def planner_revision(plans):
    if not isinstance(plans, list):
        raise HarnessRefusal('Planner read did not return a list')
    day = next((p for p in plans if p.get('date') == DAY), None)
    if day is None:
        return 0
    revision = day.get('revision')
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
        raise HarnessRefusal('Existing planner day must expose a positive revision; restart the migrated API')
    return revision


class Workload:
    def __init__(self, client, fixture, users):
        self.client, self.fixture = client, fixture
        self.users = fixture['accounts'][:users]
        self.samples = []
        self.correctness = {'owner_isolation_checks': 0, 'acknowledged_write_checks': 0, 'durable_cooking_mutations_checked': 0, 'cache_fresh_checks': 0, 'failures': 0}
        self.mutation_acks = []
        self.busy_drops = 0
        self.rng = random.Random(20260918)
        self.operations = [name for name, weight in MIX for _ in range(weight)]
        self.locks = [asyncio.Lock() for _ in self.users]

    async def request(self, user, method, path, route, *, body=None, measure=True, write=False):
        started = time.monotonic()
        status, data = 0, None
        try:
            response = await self.client.request(method, path, json=body,
                        headers={'Cookie': '', **({'Authorization': f'Bearer {user["token"]}'} if user.get('token') else {})})
            status = response.status_code
            if response.content:
                data = response.json()
        except Exception:
            status = 0
        if measure:
            self.samples.append((route, write, (time.monotonic() - started) * 1000, status))
        return status, data

    async def prepare(self):
        # Sequential logins deliberately exclude bcrypt cost from ordinary API capacity.
        for user in self.users:
            status, data = await self.request(user, 'POST', '/auth/login', 'POST /auth/login',
                body={'email': user['email'], 'password': self.fixture['password']}, measure=False)
            if status != 200 or not data or data.get('id') != user['id'] or not data.get('access_token'):
                raise HarnessRefusal('Synthetic account login failed; ordinary load was not started')
            user['token'] = data['access_token']
            status, data = await self.request(user, 'GET', '/cooking-session/active', '', measure=False)
            if status != 200:
                raise HarnessRefusal('Cooking setup read failed')
            if data is None:
                status, data = await self.request(user, 'POST', '/cooking-session', '', body={'recipe_ids': [user['recipe_id']]}, measure=False)
            if status != 200 or not data or not data.get('dishes'):
                raise HarnessRefusal('Cooking setup failed')
            user['cooking'] = data
            status, plans = await self.request(user, 'GET', f'/meal-plan?start={DAY}&end={DAY}', '', measure=False)
            if status != 200:
                raise HarnessRefusal('Planner setup read failed')
            user['planner_revision'] = planner_revision(plans)
        if self.fixture.get('cache_queries'):
            status, data = await self.request(self.users[0], 'POST', '/store-products/batch', '',
                body={'queries': self.fixture['cache_queries']}, measure=False)
            self.correctness['cache_fresh_checks'] += 1
            if status != 200 or not data or len(data.get('entries', [])) != 2 or any(e['status'] != 'fresh' for e in data['entries']):
                self.correctness['failures'] += 1
                raise HarnessRefusal('Synthetic retailer cache fixture is not fresh')
        await self.check_isolation()

    async def check_isolation(self):
        # Distinct authenticated users, direct detail and shared-library endpoints.
        for index, user in enumerate(self.users):
            other = self.users[(index + 1) % len(self.users)]
            for path in (f'/recipes/{other["recipe_id"]}', f'/users/{other["id"]}/recipes/{other["recipe_id"]}'):
                status, _ = await self.request(user, 'GET', path, '', measure=False)
                self.correctness['owner_isolation_checks'] += 1
                if status not in (403, 404):
                    self.correctness['failures'] += 1
                    raise HarnessRefusal('Owner isolation assertion failed; stopped before further load')

    async def operation(self, index):
        number = index % len(self.users)
        if self.locks[number].locked():
            self.busy_drops += 1
            return
        async with self.locks[number]:
            user = self.users[number]
            op = self.rng.choice(self.operations)
            query = f'?start={DAY}&end={DAY}'
            routes = {'library': ('GET', '/recipes/page?limit=20', 'GET /recipes/page'),
                      'catalog': ('GET', '/recipes/catalog/page?limit=20', 'GET /recipes/catalog/page'),
                      'detail': ('GET', f'/recipes/{user["recipe_id"]}', 'GET /recipes/{id}'),
                      'planner_read': ('GET', '/meal-plan' + query, 'GET /meal-plan'),
                      'cooking_read': ('GET', '/cooking-session/active', 'GET /cooking-session/active'),
                      'shopping': ('GET', '/shopping-list' + query, 'GET /shopping-list')}
            if op in routes:
                method, path, route = routes[op]
                await self.request(user, method, path, route)
            elif op == 'cached_store':
                await self.request(user, 'POST', '/store-products/batch', 'POST /store-products/batch (cache-only read)', body={'queries': self.fixture.get('cache_queries', ['rice', 'onion'])})
            elif op == 'planner_write':
                body = {'breakfast': [], 'lunch': [user['recipe_id']] if user['planner_revision'] % 2 else [],
                        'dinner': [user['recipe_id']], 'expected_revision': user['planner_revision']}
                status, data = await self.request(user, 'PUT', f'/meal-plan/{DAY}', 'PUT /meal-plan/{date}', body=body, write=True)
                if status == 200:
                    revision = data.get('revision') if isinstance(data, dict) else None
                    if revision != user['planner_revision'] + 1:
                        self.correctness['failures'] += 1
                        return
                    user['planner_revision'] = revision
                    user['plan_ack'] = body
                    user['plan_ack_revision'] = revision
            elif op == 'cooking_write':
                cooking = user['cooking']
                step = cooking['dishes'][0]['steps'][0]
                action = 'reopen' if step['state'] in ('completed', 'skipped') else 'complete'
                body = {'action': action, 'mutation_id': str(uuid.uuid4()), 'device_id': 'capacity-harness',
                        'occurred_at': datetime.now(timezone.utc).isoformat(), 'expected_revision': step['revision']}
                status, data = await self.request(user, 'POST', f'/cooking-session/{cooking["id"]}/steps/{step["id"]}/actions',
                    'POST /cooking-session/{id}/steps/{id}/actions', body=body, write=True)
                if status == 200 and data:
                    user['cooking'] = data
                    user['cooking_ack'] = data['version']
                    self.mutation_acks.append((uuid.UUID(body['mutation_id']), uuid.UUID(user['id'])))

    async def verify_writes(self):
        for user in self.users:
            if user.get('plan_ack'):
                status, data = await self.request(user, 'GET', f'/meal-plan?start={DAY}&end={DAY}', '', measure=False)
                self.correctness['acknowledged_write_checks'] += 1
                if (status != 200 or not data or planner_revision(data) != user['plan_ack_revision']
                        or any(data[0].get(slot) != user['plan_ack'][slot] for slot in ('breakfast', 'lunch', 'dinner'))):
                    self.correctness['failures'] += 1
            if user.get('cooking_ack'):
                status, data = await self.request(user, 'GET', '/cooking-session/active', '', measure=False)
                self.correctness['acknowledged_write_checks'] += 1
                if status != 200 or not data or data.get('version') != user['cooking_ack']:
                    self.correctness['failures'] += 1
        if self.mutation_acks:
            import asyncpg
            connection = await asyncpg.connect(guard_database(self.fixture['database_url']), timeout=10, command_timeout=10)
            try:
                for mutation_id, owner in self.mutation_acks:
                    found = await connection.fetchval('SELECT count(*) FROM cooking_session_mutations m JOIN cooking_sessions s ON s.id=m.session_id WHERE m.mutation_id=$1 AND s.user_id=$2', mutation_id, owner)
                    self.correctness['durable_cooking_mutations_checked'] += 1
                    if found != 1:
                        self.correctness['failures'] += 1
                self.mutation_acks.clear()
            finally:
                await connection.close()
        await self.check_isolation()


def source_identity():
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()
    digest = hashlib.sha256()
    for tree in ('backend', 'scripts/load'):
        for path in sorted((ROOT / tree).rglob('*')):
            if path.is_file() and not any(v in path.parts for v in ('.venv', '__pycache__', '.pytest_cache')) and path.suffix in ('.py', '.ini', '.txt', '.toml'):
                digest.update(str(path.relative_to(ROOT)).encode())
                digest.update(path.read_bytes())
    return {'git_revision': git('rev-parse', 'HEAD'), 'working_tree_dirty': bool(git('status', '--porcelain')),
            'backend_and_harness_sha256': digest.hexdigest()}


async def run(args):
    import httpx
    target = guard_target(args.base_url)
    path = fixture_path(args.fixture)
    if path.stat().st_mode & 0o077:
        raise HarnessRefusal('Fixture permissions must be 0600')
    fixture = json.loads(path.read_text())
    validate_fixture(fixture)
    if Path(args.output).resolve() == path:
        raise HarnessRefusal('Report cannot overwrite private fixture')
    if not 2 <= args.users <= min(200, len(fixture['accounts'])) or not 1 <= args.concurrency <= 256:
        raise HarnessRefusal('Use 2..200 distinct users and 1..256 concurrent operations')
    rates = [float(v) for v in args.rates.split(',')]
    if any(not 0 < r <= 50 for r in rates) or not 0 < args.stage_seconds <= 14400 or (1 if args.sessions else len(rates)) * args.stage_seconds > 14400:
        raise HarnessRefusal('Maximum 50 RPS and four hours total; durations must be positive')
    if args.sessions and (args.sessions not in (100, 200) or args.sessions > args.users or not 0.1 <= args.think_seconds <= 60):
        raise HarnessRefusal('Closed workload requires 100/200 distinct users and .1..60 seconds think time')
    config = safe_config(json.loads(Path(args.config).read_text())) if args.config else {}
    report = {'schema_version': 1, 'started_at_utc': datetime.now(timezone.utc).isoformat(),
              'source': source_identity(), 'config': config, 'target': target, 'provider_mode': 'disabled; cache-only retailer endpoint; no AI calls',
              'cache_case': args.cache_case, 'cache_case_verified': False,
              'dataset': {'accounts': len(fixture['accounts']), 'recipes': fixture['recipe_count'], 'catalog': fixture['catalog_count'], 'selected_library_sizes': fixture['library_sizes']},
              'workload': {'mix_percent': dict(MIX), 'users': args.users, 'max_concurrency': args.concurrency,
                           'model': 'closed-sessions' if args.sessions else 'open-arrival', 'random_seed': 20260918,
                           'stage_seconds': args.stage_seconds, 'requested_rates': rates},
              'stages': [], 'passed': False,
              'limitations': ['Local evidence only; no cloud capacity claim.', 'Login preparation is excluded from ordinary route timing.',
                'No signup/upload/AI/provider/recovery drill included.', 'CPU/memory/DB wait/locks must be collected externally.',
                'Cold/warm label is operator-declared; setup itself warms authentication and cooking paths.',
                'Synthetic retailer cache responses are not live provider capacity proof.']}
    started = time.monotonic()
    async with httpx.AsyncClient(base_url=target, timeout=10, follow_redirects=False, trust_env=False,
                                limits=httpx.Limits(max_connections=args.concurrency, max_keepalive_connections=args.concurrency)) as client:
        workload = Workload(client, fixture, args.users)
        try:
            await asyncio.wait_for(workload.prepare(), timeout=min(600, 20 * args.users))
            for rate in rates if not args.sessions else [None]:
                workload.samples = []
                workload.busy_drops = 0
                if args.sessions:
                    stage_start = time.monotonic()
                    async def session(number):
                        while time.monotonic() - stage_start < args.stage_seconds:
                            await workload.operation(number)
                            await asyncio.sleep(args.think_seconds)
                    await asyncio.gather(*(session(i) for i in range(args.sessions)))
                    scheduling = {'dropped': 0, 'duration_seconds': time.monotonic() - stage_start}
                else:
                    scheduling = await open_arrivals(rate, args.stage_seconds, args.concurrency, workload.operation)
                summary = summarize(workload.samples, scheduling['dropped'] + workload.busy_drops, scheduling['duration_seconds'])
                summary.update({'requested_rps': rate, 'sessions': args.sessions or None,
                                'duration_seconds': round(scheduling['duration_seconds'], 3)})
                report['stages'].append(summary)
                await workload.verify_writes()
                if workload.correctness['failures']:
                    break
            report['correctness'] = workload.correctness
            report['passed'] = bool(report['stages']) and all(s['passed'] for s in report['stages']) and not workload.correctness['failures'] and workload.correctness['acknowledged_write_checks'] > 0
            report['highest_passing_rps'] = max((s['requested_rps'] for s in report['stages'] if s['passed'] and s['requested_rps']), default=None) if not workload.correctness['failures'] else None
        except Exception as exc:
            # Never expose response bodies, credentials, URLs from exceptions, or fixture content.
            report['aborted'] = type(exc).__name__
            if isinstance(exc, HarnessRefusal):
                report['refusal_reason'] = str(exc)
            report['correctness'] = workload.correctness
        finally:
            report['duration_seconds_including_setup'] = round(time.monotonic() - started, 3)
            report['finished_at_utc'] = datetime.now(timezone.utc).isoformat()
            Path(args.output).write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'report': str(Path(args.output).resolve()), 'passed': report['passed'], 'highest_passing_rps': report.get('highest_passing_rps')}))
    return 0 if report['passed'] else 1


async def cleanup(args):
    import asyncpg
    path = fixture_path(args.fixture)
    if path.stat().st_mode & 0o077:
        raise HarnessRefusal('Fixture permissions must be 0600')
    fixture = json.loads(path.read_text())
    validate_fixture(fixture)
    connection = await asyncpg.connect(guard_database(fixture['database_url']), timeout=10, command_timeout=60)
    try:
        async with connection.transaction():
            for user in fixture['accounts']:
                await connection.execute('DELETE FROM users WHERE id=$1 AND email=$2', uuid.UUID(user['id']), user['email'])
            prefix = f"capacity-{uuid.UUID(fixture['namespace']).hex}-"
            for query in fixture.get('cache_queries', []):
                if not query.startswith(prefix):
                    raise HarnessRefusal('Cache cleanup namespace mismatch')
                await connection.execute('DELETE FROM cached_store_products WHERE query=$1', query)
    finally:
        await connection.close()
    path.unlink()
    print(json.dumps({'removed_fixture_accounts': len(fixture['accounts']), 'fixture_removed': True}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('seed', help='Insert synthetic records into a dedicated, already-migrated local database')
    p.add_argument('--database-url', required=True)
    p.add_argument('--fixture', required=True)
    p.add_argument('--accounts', type=int, default=10000)
    p.add_argument('--library-sizes', default='10,100,1000,10000')
    p.add_argument('--catalog', type=int, default=1000)
    p = sub.add_parser('cleanup', help='Delete only fixture-owned synthetic users and their cascading data')
    p.add_argument('--fixture', required=True)
    p = sub.add_parser('run', help='Execute an ordinary API workload, no provider traffic')
    p.add_argument('--base-url', required=True)
    p.add_argument('--fixture', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--config', help='JSON resource config; only documented nonsecret keys are retained')
    p.add_argument('--users', type=int, default=100)
    p.add_argument('--concurrency', type=int, default=100)
    p.add_argument('--rates', default='5,10,25,50')
    p.add_argument('--stage-seconds', type=float, default=600)
    p.add_argument('--sessions', type=int, default=0)
    p.add_argument('--think-seconds', type=float, default=2)
    p.add_argument('--cache-case', choices=['cold-declared', 'warm-declared', 'unspecified'], default='unspecified')
    args = parser.parse_args()
    try:
        return asyncio.run({'seed': seed, 'run': run, 'cleanup': cleanup}[args.command](args)) or 0
    except (ValueError, OSError) as exc:
        reason = str(exc) if isinstance(exc, HarnessRefusal) else type(exc).__name__
        print(f'Capacity harness refused or failed: {reason}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())

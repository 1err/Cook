"""Real cross-worker races for menu creation using the opt-in disposable DB."""
import asyncio
from uuid import uuid4

import pytest
from sqlalchemy import select

from test_postgres_integrations import pg_sessions, add_user
from app.db import repo_menu_creations
from app.db.models import AIUsageCounterModel, MenuCreationModel


@pytest.mark.asyncio
@pytest.mark.parametrize('same_id', [False, True])
async def test_menu_creation_concurrency(pg_sessions, same_id):
    owner, shared_id = await add_user(pg_sessions), uuid4()
    async def create():
        async with pg_sessions() as session:
            try:
                row = await repo_menu_creations.create_menu(session, owner, shared_id if same_id else uuid4())
                await session.commit()
                return row.request_id
            except repo_menu_creations.MenuDailyLimitExceeded:
                await session.rollback()
                return None
    results = await asyncio.gather(*(create() for _ in range(12)))
    assert sum(value is not None for value in results) == (12 if same_id else 1)
    async with pg_sessions() as session:
        rows = (await session.execute(select(MenuCreationModel).where(MenuCreationModel.user_id == owner))).scalars().all()
        assert len(rows) == 1
        counter = (await session.execute(select(AIUsageCounterModel).where(
            AIUsageCounterModel.scope == repo_menu_creations.creation_scope(owner),
        ))).scalar_one()
        assert counter.request_count == 1


@pytest.mark.asyncio
async def test_menu_owned_receipt_survives_deletion_for_cleanup(pg_sessions, monkeypatch):
    from app.core.config import settings
    from app.db import session as db
    from app.db.models import UserModel
    from app.db.account_models import OwnedImageModel
    from app.db.repo_account_cleanup import delete_user_and_queue_cleanup
    from app.services.owned_images import reserve_owned_image, finish_owned_upload
    monkeypatch.setattr(db, 'async_session_maker', pg_sessions)
    monkeypatch.setattr(settings, 'AWS_REGION', '')
    monkeypatch.setattr(settings, 'S3_BUCKET_NAME', '')
    owner = await add_user(pg_sessions)
    request_id = uuid4()
    async with pg_sessions.begin() as session:
        await repo_menu_creations.create_menu(session, owner, request_id)
    receipt = await reserve_owned_image(owner, 0, 'image/png', 'http://localhost', namespace='menu-artwork')
    assert receipt['object_key'].startswith(f'menu-artwork/{owner}/')
    await finish_owned_upload(receipt['id'])
    async with pg_sessions.begin() as session:
        user = (await session.execute(select(UserModel).where(UserModel.id == owner).with_for_update())).scalar_one()
        await delete_user_and_queue_cleanup(session, user)
    async with pg_sessions() as session:
        retained = await session.get(OwnedImageModel, receipt['id'])
        assert retained is not None and retained.cleanup_requested
        assert retained.object_key == receipt['object_key']
        assert not (await session.execute(select(MenuCreationModel).where(MenuCreationModel.user_id == owner))).scalars().all()
        assert not (await session.execute(select(AIUsageCounterModel).where(
            AIUsageCounterModel.scope == repo_menu_creations.creation_scope(owner),
        ))).scalars().all()

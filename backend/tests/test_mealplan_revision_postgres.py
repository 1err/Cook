"""Real concurrent sessions prove CAS and deletion cannot clobber newer rows."""
import asyncio
import os
import uuid

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.db.models import UserModel, MealPlanModel
from app.db.repo_mealplan import put_meal_plan, get_meal_plans_in_range, remove_recipe_id_from_user_plans, MealPlanConflict

URL=os.environ.get('TEST_DATABASE_URL','')
pytestmark=[pytest.mark.asyncio,pytest.mark.skipif(not URL,reason='Requires disposable PostgreSQL')]

async def seed(engine):
    owner=uuid.uuid4()
    async with async_sessionmaker(engine)() as session:
        session.add(UserModel(id=owner,email=f'{owner}@example.test'))
        await session.commit()
    return owner

async def cleanup(engine,owner):
    async with engine.begin() as conn:
        await conn.execute(delete(UserModel).where(UserModel.id==owner))
    await engine.dispose()

async def test_concurrent_initial_and_existing_writes_have_exactly_one_winner():
    engine=create_async_engine(URL)
    owner=await seed(engine)
    try:
        for revision in [0,1]:
            barrier=asyncio.Barrier(2)
            async def write(name):
                async with async_sessionmaker(engine)() as session:
                    await barrier.wait()
                    try:
                        row=await put_meal_plan(session,'2026-09-18',{'dinner':[name]},owner,expected_revision=revision)
                        await session.commit()
                        return row
                    except MealPlanConflict:
                        await session.rollback()
                        return None
            results=await asyncio.gather(write('device-a'),write('device-b'))
            winners=[row for row in results if row is not None]
            assert len(winners)==1 and winners[0].revision==revision+1
            async with async_sessionmaker(engine)() as session:
                saved=await get_meal_plans_in_range(session,'2026-09-18','2026-09-18',owner)
                assert saved[0].dinner==winners[0].dinner and saved[0].revision==revision+1
    finally:
        await cleanup(engine,owner)

async def test_recipe_cleanup_and_device_edit_are_atomic_and_preserve_unrelated_changes():
    engine=create_async_engine(URL)
    owner=await seed(engine)
    try:
        async with async_sessionmaker(engine)() as session:
            await put_meal_plan(session,'2026-09-18',{'dinner':['remove','keep']},owner,expected_revision=0)
            await put_meal_plan(session,'2026-09-19',{'dinner':['unaffected']},owner,expected_revision=0)
            await session.commit()
        barrier=asyncio.Barrier(2)
        async def edit():
            async with async_sessionmaker(engine)() as session:
                await barrier.wait()
                try:
                    await put_meal_plan(session,'2026-09-18',{'breakfast':['other'],'dinner':['remove','keep','new']},owner,expected_revision=1)
                    await session.commit()
                    return True
                except MealPlanConflict:
                    await session.rollback()
                    return False
        async def remove():
            async with async_sessionmaker(engine)() as session:
                await barrier.wait()
                await remove_recipe_id_from_user_plans(session,owner,'remove')
                await session.commit()
        edited,_=await asyncio.gather(edit(),remove())
        async with async_sessionmaker(engine)() as session:
            rows=await get_meal_plans_in_range(session,'2026-09-18','2026-09-19',owner)
            assert rows[0].dinner==(['keep','new'] if edited else ['keep'])
            assert rows[0].breakfast==(['other'] if edited else [])
            assert rows[0].revision==(3 if edited else 2)
            assert rows[1].dinner==['unaffected'] and rows[1].revision==1
    finally:
        await cleanup(engine,owner)

async def test_recipe_cleanup_normalizes_legacy_arrays_and_increments_only_affected_rows():
    engine=create_async_engine(URL)
    owner=await seed(engine)
    try:
        async with async_sessionmaker(engine)() as session:
            session.add(MealPlanModel(user_id=owner,date='2026-09-18',recipe_ids='["remove","keep","remove"]',revision=1))
            await session.commit()
            await remove_recipe_id_from_user_plans(session,owner,'remove')
            await session.commit()
            rows=await get_meal_plans_in_range(session,'2026-09-18','2026-09-18',owner)
            assert rows[0].dinner==['keep'] and rows[0].revision==2
    finally:
        await cleanup(engine,owner)

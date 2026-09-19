"""Opt-in PostgreSQL paging contracts; synthetic rows always roll back."""
import os
import uuid
import pytest
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.db.models import RecipeModel, UserModel
from app.db.repo_recipes import recipe_page

URL = os.environ.get('TEST_DATABASE_URL', '')
pytestmark = [pytest.mark.asyncio, pytest.mark.skipif(not URL, reason='Requires disposable PostgreSQL')]

async def test_real_keyset_scopes_filters_copy_state_and_live_changes():
    engine = create_async_engine(URL)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            caller, owner, other = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
            session.add_all([UserModel(id=id, email=f'{id}@example.test', is_library_public=id==owner) for id in [caller, owner, other]])
            await session.flush()
            prefix = uuid.uuid4().hex
            def recipe(suffix, user=owner, **fields):
                return RecipeModel(id=prefix+suffix,user_id=user,title=fields.pop('title','Same'),ingredients='[]',steps='[]',**fields)
            # Other integration tests may leave public synthetic recipes. Give
            # this global catalog scenario its own searchable namespace.
            a,b,c = [recipe(x,title=prefix+' Same',is_public_catalog=True) for x in ['a','b','c']]
            copied = recipe('copy',user=caller,catalog_source_recipe_id=b.id)
            legacy = recipe('legacy',title='100%_Soup',library_category='quick_dinner')
            both = recipe('both',title='Soup',library_tags='["quick","vegetarian"]')
            session.add_all([a,b,c,copied,legacy,both,recipe('private',user=other)])
            await session.flush()
            first = await recipe_page(session, caller, catalog=True, q=prefix, limit=1)
            assert [r.id for r in first.items] == [a.id]
            second = await recipe_page(session, caller, catalog=True, q=prefix, limit=1, cursor=first.next_cursor)
            assert [r.id for r in second.items] == [b.id] and second.items[0].already_saved
            third = await recipe_page(session, caller, catalog=True, q=prefix, limit=1, cursor=second.next_cursor)
            assert [r.id for r in third.items] == [c.id] and third.next_cursor is None
            assert [r.id for r in (await recipe_page(session, caller)).items] == [copied.id]
            literal = await recipe_page(session, caller, owner_id=owner, q='100%_',tags=['quick'])
            assert [r.id for r in literal.items] == [legacy.id]
            filtered = await recipe_page(session, caller, owner_id=owner,tags=['quick','vegetarian'])
            assert [r.id for r in filtered.items] == [both.id]
            (await session.get(UserModel,owner)).is_library_public = False
            b.is_public_catalog = False
            await session.flush()
            assert not (await recipe_page(session,caller,owner_id=owner)).items
            assert [r.id for r in (await recipe_page(session,caller,catalog=True,q=prefix,limit=1,cursor=first.next_cursor)).items] == [c.id]
            await session.rollback()
    finally:
        await engine.dispose()

async def test_large_library_bound_insert_delete_cursor_semantics():
    engine = create_async_engine(URL)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            caller,prefix = uuid.uuid4(),uuid.uuid4().hex
            session.add(UserModel(id=caller,email=f'{caller}@example.test'))
            await session.flush()
            session.add_all([RecipeModel(id=f'{prefix}{i:04}',user_id=caller,title=f'Recipe {i:04}',ingredients='[]',steps='[]') for i in range(1001)])
            await session.flush()
            first = await recipe_page(session,caller)
            assert len(first.items) == 40 and first.next_cursor
            await session.delete(await session.get(RecipeModel,first.items[-1].id))
            session.add_all([RecipeModel(id=prefix+x,user_id=caller,title=title,ingredients='[]',steps='[]') for x,title in [('before','AAA'),('after','Recipe 0039z')]])
            await session.flush()
            second = await recipe_page(session,caller,cursor=first.next_cursor)
            assert len(second.items) == 40 and second.items[0].id == prefix+'after'
            assert not {r.id for r in first.items} & {r.id for r in second.items}
            assert (await recipe_page(session,caller,limit=1)).items[0].id == prefix+'before'
            await session.rollback()
    finally:
        await engine.dispose()

async def test_long_unicode_titles_fit_prefix_indexes_and_remain_fully_sorted():
    from sqlalchemy import text
    engine = create_async_engine(URL)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            caller,prefix = uuid.uuid4(),uuid.uuid4().hex
            session.add(UserModel(id=caller,email=f'{caller}@example.test'))
            await session.flush()
            # Poorly compressible CJK titles permitted by the existing varchar(1024).
            common = ''.join(chr(0x4e00+i) for i in range(1023))
            session.add_all([RecipeModel(id=prefix+x,user_id=caller,title=common+x,ingredients='[]',steps='[]') for x in ['c','a','b']])
            await session.flush()
            ids=[]
            cursor=None
            for _ in range(3):
                page=await recipe_page(session,caller,limit=1,cursor=cursor)
                ids.extend(r.id for r in page.items)
                cursor=page.next_cursor
            assert ids == [prefix+x for x in ['a','b','c']]
            assert cursor is None
            await session.rollback()
    finally:
        await engine.dispose()

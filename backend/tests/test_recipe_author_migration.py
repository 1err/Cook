"""Compile both migration directions without needing any database connection."""
import importlib.util
from io import StringIO
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations


def test_author_migration_emits_nullable_fk_unique_identity_and_reversible_ddl():
    path = Path(__file__).parents[1] / "alembic/versions/20261101_recipe_authors.py"
    spec = importlib.util.spec_from_file_location("recipe_author_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    output = StringIO()
    context = MigrationContext.configure(dialect_name="postgresql", opts={"as_sql": True, "output_buffer": output})
    with Operations.context(context):
        module.upgrade()
        upgrade = output.getvalue()
        output.seek(0)
        output.truncate()
        module.downgrade()
        downgrade = output.getvalue()
    assert "PRIMARY KEY (normalized_name)" in upgrade
    assert "ADD COLUMN author_id VARCHAR(36)" in upgrade
    assert "FOREIGN KEY(author_id) REFERENCES recipe_authors (id) ON DELETE SET NULL" in upgrade
    assert "ALTER TABLE recipes DROP COLUMN author_id" in downgrade
    assert "DROP TABLE recipe_author_keys" in downgrade and "DROP TABLE recipe_authors" in downgrade
    assert "DROP TABLE recipes;" not in downgrade

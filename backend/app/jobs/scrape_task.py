"""One scraper invocation; the Linux subreaper supervisor owns all descendants."""
import asyncio
import json
import sys

from app.services import weee_scraper


async def scrape(payload):
    try:
        return weee_scraper.validate_products(await weee_scraper.scrape_weee_products(payload['query'], payload['language']))
    finally:
        await weee_scraper.shutdown_weee_scraper()


def serialize_products(products):
    encoded = json.dumps(products, separators=(',', ':')).encode('utf-8')
    if len(encoded) > 65536:
        raise weee_scraper.StoreScrapeError('Store product result is too large')
    return encoded


if __name__ == '__main__':
    result = asyncio.run(scrape(json.loads(sys.stdin.buffer.read(4096))))
    # Reject oversized untrusted fields before any bytes enter the stdout pipe.
    sys.stdout.buffer.write(serialize_products(result))
    sys.stdout.buffer.flush()

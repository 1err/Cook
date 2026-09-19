# Backend image. Run python -m app.migrate once before updating the API service.
FROM python:3.12-slim

WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && playwright install --with-deps chromium
RUN chmod -R a+rX /ms-playwright \
    && groupadd --gid 1001 cooking \
    && useradd --uid 1001 --gid cooking --create-home cooking

COPY . .
RUN mkdir -p /app/uploads /app/data \
    && chown -R cooking:cooking /app/uploads /app/data

ENV PYTHONUNBUFFERED=1
ENV APP_ENV=production
ENV PYTHONPATH=/app
ENV PYTHONDONTWRITEBYTECODE=1

USER cooking

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-proxy-headers"]

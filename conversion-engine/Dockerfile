FROM python:3.12-slim AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /build
COPY pyproject.toml README.md ./
COPY src ./src
RUN python -m pip install --prefix=/install .

FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=8000 \
    MAX_CONCURRENT_CONVERSIONS=1

RUN groupadd --system stitchwish \
    && useradd --system --gid stitchwish --create-home --home-dir /home/stitchwish stitchwish

COPY --from=builder /install /usr/local

USER stitchwish
WORKDIR /home/stitchwish
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT', '8000') + '/v1/health', timeout=2)"

CMD ["python", "-m", "stitch_wish"]

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=10000
WORKDIR /app
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt \
    && groupadd --system vibepro && useradd --system --gid vibepro --home-dir /app vibepro
COPY backend /app/backend
COPY engine /app/engine
COPY web /app/web
RUN mkdir -p /var/data && chown -R vibepro:vibepro /app /var/data
USER vibepro
WORKDIR /app/backend
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:'+os.getenv('PORT','10000')+'/health',timeout=3)" || exit 1
CMD ["sh", "-c", "exec gunicorn app:app --bind 0.0.0.0:${PORT:-10000} --workers 2 --worker-class uvicorn.workers.UvicornWorker --access-logfile /dev/null --error-logfile -"]

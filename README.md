# sci-graph-starter

Стартовый каркас knowledge graph + GraphRAG для трека «Научный клубок».
Собран так, чтобы **пережить смену ТЗ**: вся доменная схема — в `backend/app/ontology.yaml`,
контракт API и инфраструктура от ТЗ не зависят.

## Что уже работает из коробки

- Neo4j (граф + векторный индекс) поднимается одной командой.
- Seed-граф (`schema.cypher`) — 3 сплава / режимы / эксперименты / свойства / команды, написаны руками.
- FastAPI со всеми эндпоинтами и переключателем `USE_MOCK` (фронт работает, даже если граф пуст).
- Параметризованные Cypher-шаблоны под канонические вопросы + карта пробелов.
- Фронт на React+TS с моками: трёхпанельник, граф, таблица доказательств, heatmap.
- Скелет офлайн-извлечения: парсинг → linking по справочникам → LLM (guided_json) → загрузка.

## Быстрый старт (10 минут)

```bash
# 1. Поднять Neo4j + загрузить seed-граф
docker compose up -d neo4j
# дождаться старта, затем:
docker exec -i neo4j cypher-shell -u neo4j -p password < backend/schema.cypher

# 2. Бэкенд
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload    # http://localhost:8000/docs

# 3. Фронт (в другом терминале)
cd frontend
npm install
npm run dev                      # http://localhost:5173
```

Neo4j Browser на http://localhost:7474 (neo4j / password) — визуальный дебаг графа бесплатно.

## Разделение работы (команда 2 чел.)

- **Фронт (React+TS):** `frontend/` — стартует на `mock.ts`, потом `VITE_USE_MOCK=false`.
- **DS+бэк:** `backend/` — seed-граф → эндпоинты → вечером дня 1 реальное извлечение.

## ⚠️ Когда придёт ТЗ и данные — менять только это:

1. `backend/app/ontology.yaml` — типы узлов/связей под новую онтологию (главный файл).
2. `backend/data/gazetteers/*.csv` — выданные справочники материалов/оборудования/сотрудников.
3. `backend/app/extract.py` → функция `parse_document` — под реальные форматы файлов.
4. `backend/schema.cypher` — поправить seed под реальные имена сущностей (или сгенерить из данных).
5. `backend/app/queries.py` — если в ТЗ появятся новые типы вопросов.

Контракт (`models.py` / `types.ts`) и инфраструктуру **после старта не трогаем.**

## Переключатели

- `backend/.env`: `USE_MOCK=true|false`, `NEO4J_*`, `LLM_BASE_URL`, `LLM_MODEL`.
- `frontend/.env`: `VITE_USE_MOCK=true|false`, `VITE_API_URL`.

#! usr/bin/env bash

PGPASSWORD=password psql -h localhost -p 5432 -U aiware -d aiware -c "CREATE EXTENSION IF NOT EXISTS \"vector\""

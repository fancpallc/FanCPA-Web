#!/bin/sh
docker-compose run --rm frontend bash -c "cd /app && npx vitest run src/components/calendar/CalendarView.test.tsx"

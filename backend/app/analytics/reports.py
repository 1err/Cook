"""Bounded, parameterized PostgreSQL reports. All reporting days use UTC."""

from datetime import datetime, timedelta, timezone
from sqlalchemy import text
from app.analytics.repository import admin_ids, collection_health
from app.analytics.schema import DateRange

ELIGIBLE = """WITH internal AS (
 SELECT u.id FROM users u LEFT JOIN analytics_profiles p ON p.user_id=u.id
 WHERE u.id=ANY(CAST(:admins AS uuid[])) OR COALESCE(p.is_test,false)
), eligible AS (
 SELECT e.* FROM analytics_events e WHERE :include_internal OR (
 NOT e.is_internal AND NOT EXISTS(SELECT 1 FROM internal i WHERE i.id=e.user_id)
 AND (e.user_id IS NOT NULL OR e.visitor_id IS NULL OR NOT EXISTS (
   SELECT 1 FROM analytics_events ie JOIN internal i ON ie.user_id=i.id WHERE ie.visitor_id=e.visitor_id AND ie.session_id=e.session_id))))
"""
ACTIVE = "(name IN ('recipe_saved','meal_planned','cooking_started','cooking_completed','retailer_handoff','retailer_link_created') OR (name='page_view' AND path ~ '^/(library|recipe|import|planner|shopping-list|cook)(/|$)'))"
USER_FILTER = "(:include_internal OR (NOT u.id=ANY(CAST(:admins AS uuid[])) AND NOT COALESCE(p.is_test,false)))"


def parameters(period):
    start, end = period.bounds
    return {
        "start": start,
        "end": end,
        "admins": admin_ids(),
        "include_internal": period.include_internal,
    }


async def rows(session, sql, params):
    return [dict(r) for r in (await session.execute(text(sql), params)).mappings()]


async def one(session, sql, params):
    return (await rows(session, sql, params))[0]


async def statistics(session, period):
    p = parameters(period)
    counts = await one(
        session,
        ELIGIBLE
        + f"""SELECT
      count(DISTINCT user_id) FILTER(WHERE {ACTIVE}) AS active_users,
      count(*) FILTER(WHERE name='login') AS logins,
      count(DISTINCT user_id) FILTER(WHERE name='login') AS unique_logins,
      count(DISTINCT visitor_id) FILTER(WHERE name='page_view') AS visitors,
      count(DISTINCT session_id) FILTER(WHERE name='page_view') AS visits,
      count(*) FILTER(WHERE name='page_view') AS page_views,
      count(*) FILTER(WHERE name='recipe_saved') AS recipes_saved,
      count(*) FILTER(WHERE name='cooking_completed') AS cooking_completed,
      count(*) FILTER(WHERE name='retailer_handoff') AS retailer_handoffs
      FROM eligible WHERE occurred_at>=:start AND occurred_at<:end""",
        p,
    )
    accounts = await one(
        session,
        f"""SELECT count(*) AS total_users,
      count(*) FILTER(WHERE u.id=ANY(CAST(:admins AS uuid[])) OR COALESCE(p.is_test,false)) AS internal_users,
      count(*) FILTER(WHERE u.created_at>=:start AND u.created_at<:end AND {USER_FILTER}) AS new_users
      FROM users u LEFT JOIN analytics_profiles p ON p.user_id=u.id""",
        p,
    )
    return {**counts, **accounts}


async def overview(session, period: DateRange):
    p = parameters(period)
    now = datetime.now(timezone.utc)
    state = await one(
        session,
        "SELECT started_at,last_event_at,last_rollup_at FROM analytics_state WHERE id=1",
        {},
    )
    available = max(state["started_at"], now - timedelta(days=90))
    totals = await statistics(session, period)
    previous_period = DateRange(
        start=period.start - timedelta(days=period.days),
        end=period.start - timedelta(days=1),
        include_internal=period.include_internal,
    )
    previous = await statistics(session, previous_period)
    active = await one(
        session,
        ELIGIBLE
        + f"""SELECT
       count(DISTINCT user_id) FILTER(WHERE occurred_at>=CAST(:end AS timestamptz)-interval '1 day') AS daily,
       count(DISTINCT user_id) FILTER(WHERE occurred_at>=CAST(:end AS timestamptz)-interval '7 days') AS weekly,
       count(DISTINCT user_id) AS monthly FROM eligible
       WHERE occurred_at>=CAST(:end AS timestamptz)-interval '30 days' AND occurred_at<:end AND {ACTIVE}""",
        p,
    )
    series = await rows(
        session,
        ELIGIBLE
        + f"""SELECT (occurred_at AT TIME ZONE 'UTC')::date AS day,
       count(DISTINCT user_id) FILTER(WHERE {ACTIVE}) AS active_users,
       count(DISTINCT visitor_id) FILTER(WHERE name='page_view') AS visitors,
       count(*) FILTER(WHERE name='page_view') AS page_views
       FROM eligible WHERE occurred_at>=:start AND occurred_at<:end GROUP BY 1 ORDER BY 1""",
        p,
    )
    signups = await rows(
        session,
        f"""SELECT (u.created_at AT TIME ZONE 'UTC')::date AS day,count(*) AS signups
       FROM users u LEFT JOIN analytics_profiles p ON p.user_id=u.id
       WHERE u.created_at>=:start AND u.created_at<:end AND {USER_FILTER} GROUP BY 1""",
        p,
    )
    by_day = {r["day"]: r for r in series}
    signup_days = {r["day"]: r["signups"] for r in signups}
    daily = []
    for i in range(period.days):
        day = period.start + timedelta(days=i)
        observed = day >= available.date() and day <= now.date()
        daily.append(
            {
                "day": day,
                "signups": signup_days.get(day, 0),
                "active_users": 0 if observed else None,
                "visitors": 0 if observed else None,
                "page_views": 0 if observed else None,
                **by_day.get(day, {}),
                "partial": day == available.date(),
            }
        )
    groupings = {
        "sources": "COALESCE(source,referrer,'Direct / unknown')",
        "pages": "COALESCE(path,'Other')",
        "devices": "COALESCE(device,'unknown')",
        "browsers": "COALESCE(browser,'Other')",
        "campaigns": "COALESCE(campaign,'No campaign')",
    }
    acquisition = {}
    for key, expression in groupings.items():
        acquisition[key] = await rows(
            session,
            ELIGIBLE
            + f"""SELECT {expression} AS label,
         count(*) FILTER(WHERE name='page_view') AS views,
         count(DISTINCT visitor_id) FILTER(WHERE name='page_view') AS visitors,
         count(DISTINCT user_id) FILTER(WHERE name='registered') AS signups
         FROM eligible WHERE occurred_at>=:start AND occurred_at<:end AND name IN ('page_view','registered')
         GROUP BY 1 ORDER BY views DESC,label LIMIT 12""",
            p,
        )
    acquisition["landing_pages"] = await rows(
        session,
        ELIGIBLE
        + """, first_pages AS (
          SELECT DISTINCT ON (session_id) session_id, visitor_id, path, occurred_at
          FROM eligible WHERE name='page_view' AND session_id IS NOT NULL
          ORDER BY session_id,occurred_at,id
        ) SELECT path AS label,count(*) AS views,count(DISTINCT visitor_id) AS visitors,0 AS signups
          FROM first_pages WHERE occurred_at>=:start AND occurred_at<:end
          GROUP BY path ORDER BY views DESC,path LIMIT 12""",
        p,
    )
    conversion = await one(
        session,
        ELIGIBLE
        + """SELECT
      count(DISTINCT r.visitor_id) FILTER(WHERE EXISTS(SELECT 1 FROM eligible v WHERE v.name='page_view' AND v.visitor_id=r.visitor_id AND v.occurred_at>=:start AND v.occurred_at<:end)) AS converted_visitors,
      count(*) FILTER(WHERE r.visitor_id IS NULL) AS unattributed_signups
      FROM eligible r WHERE r.name='registered' AND r.occurred_at>=:start AND r.occurred_at<:end""",
        p,
    )
    acquisition.update(conversion)
    acquisition["signup_conversion"] = (
        round(100 * conversion["converted_visitors"] / totals["visitors"], 1)
        if totals["visitors"]
        else None
    )
    events = await rows(
        session,
        ELIGIBLE
        + """SELECT name,count(*) AS count,count(DISTINCT user_id) AS users
       FROM eligible WHERE occurred_at>=:start AND occurred_at<:end AND name NOT IN ('page_view','login','registered')
       GROUP BY name ORDER BY count DESC""",
        p,
    )
    funnel = await one(
        session,
        f"""SELECT count(*) AS signed_up,
       count(*) FILTER(WHERE p.first_recipe_at>=u.created_at AND p.first_recipe_at<u.created_at+interval '7 days') AS saved_recipe,
       count(*) FILTER(WHERE p.first_plan_at>=u.created_at AND p.first_plan_at<u.created_at+interval '7 days') AS planned_meal,
       count(*) FILTER(WHERE p.first_cook_at>=u.created_at AND p.first_cook_at<u.created_at+interval '7 days') AS started_cooking,
       count(*) FILTER(WHERE p.first_completion_at>=u.created_at AND p.first_completion_at<u.created_at+interval '7 days') AS completed_cooking,
       count(*) FILTER(WHERE u.created_at<=now()-interval '7 days') AS mature_users
       FROM users u LEFT JOIN analytics_profiles p ON p.user_id=u.id
       WHERE u.created_at>=GREATEST(CAST(:start AS timestamptz),CAST(:available AS timestamptz)) AND u.created_at<:end AND {USER_FILTER}""",
        {**p, "available": available},
    )
    cohort_rows = await rows(
        session,
        ELIGIBLE
        + f""", cohort_users AS (
       SELECT u.id,date_trunc('week',u.created_at AT TIME ZONE 'UTC')::date AS week FROM users u
       LEFT JOIN analytics_profiles p ON p.user_id=u.id
       WHERE u.created_at>=GREATEST(CAST(:start AS timestamptz),CAST(:available AS timestamptz)) AND u.created_at<:end AND {USER_FILTER}
       ), cohort_sizes AS (SELECT week,count(*) AS users FROM cohort_users GROUP BY week)
       SELECT c.week,c.users,n.week_index,count(DISTINCT e.user_id) AS retained
       FROM cohort_sizes c CROSS JOIN generate_series(0,4) AS n(week_index)
       LEFT JOIN cohort_users u ON u.week=c.week
       LEFT JOIN eligible e ON e.user_id=u.id AND {ACTIVE.replace("name", "e.name").replace("path", "e.path")}
         AND (e.occurred_at AT TIME ZONE 'UTC')::date>=c.week+n.week_index*7
         AND (e.occurred_at AT TIME ZONE 'UTC')::date<c.week+(n.week_index+1)*7
       GROUP BY c.week,c.users,n.week_index ORDER BY c.week DESC,n.week_index""",
        {**p, "available": available},
    )
    cohorts = {}
    for r in cohort_rows:
        entry = cohorts.setdefault(
            r["week"], {"week": r["week"], "users": r["users"], "weeks": []}
        )
        completed = r["week"] + timedelta(days=(r["week_index"] + 1) * 7) <= now.date()
        entry["weeks"].append(
            round(100 * r["retained"] / r["users"], 1) if completed else None
        )
    return {
        "range": period.model_dump(),
        "timezone": "UTC",
        "refreshed_at": now,
        "tracking_started_at": state["started_at"],
        "collection": collection_health(),
        "coverage": {
            "available_from": available,
            "partial": p["start"] < available,
            "unavailable": p["end"] <= available,
            "previous_complete": previous_period.bounds[0] >= available,
            "last_event_at": state["last_event_at"],
        },
        "totals": totals,
        "previous": previous,
        "active": active,
        "series": daily,
        "acquisition": acquisition,
        "engagement": {
            "events": events,
            "funnel": funnel,
            "cohorts": list(cohorts.values()),
        },
    }


async def users_page(session, period, query="", limit=25, offset=0, user_id=None):
    p = {
        **parameters(period),
        "query": query,
        "limit": limit,
        "offset": offset,
        "user_id": user_id,
    }
    where = "WHERE strpos(lower(u.email),lower(:query))>0 AND (CAST(:user_id AS uuid) IS NULL OR u.id=CAST(:user_id AS uuid))"
    total = (await one(session, "SELECT count(*) AS total FROM users u " + where, p))[
        "total"
    ]
    items = await rows(
        session,
        """SELECT u.id,u.email,u.created_at,
      u.id=ANY(CAST(:admins AS uuid[])) AS is_admin,COALESCE(p.is_test,false) AS is_test,
      p.last_login_at,p.last_seen_at,p.first_recipe_at,p.first_plan_at,p.first_cook_at,
      (SELECT count(*) FROM recipes r WHERE r.user_id=u.id) AS recipes,
      (SELECT count(*) FROM meal_plan m WHERE m.user_id=u.id) AS plan_rows,
      (SELECT count(*) FROM analytics_events e WHERE e.user_id=u.id AND e.name='login' AND e.occurred_at>=:start AND e.occurred_at<:end) AS logins
      FROM users u LEFT JOIN analytics_profiles p ON p.user_id=u.id """
        + where
        + " ORDER BY u.created_at DESC,u.id LIMIT :limit OFFSET :offset",
        p,
    )
    state = await one(session, "SELECT started_at FROM analytics_state WHERE id=1", {})
    available = max(
        state["started_at"], datetime.now(timezone.utc) - timedelta(days=90)
    )
    coverage = {
        "available_from": available,
        "partial": p["start"] < available,
        "unavailable": p["end"] <= available,
    }
    for item in items:
        if coverage["unavailable"]:
            item["logins"] = None
        item["login_coverage"] = (
            "unavailable"
            if coverage["unavailable"]
            else "partial"
            if coverage["partial"]
            else "complete"
        )
    return {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
        "coverage": coverage,
    }


async def user_detail(session, user_id, period):
    page = await users_page(session, period, user_id=user_id, limit=1)
    if not page["items"]:
        return None
    events = await rows(
        session,
        """SELECT occurred_at,name,platform,path FROM analytics_events
      WHERE user_id=:id AND occurred_at>=:start AND occurred_at<:end ORDER BY occurred_at DESC,id DESC LIMIT 50""",
        {"id": user_id, **parameters(period)},
    )
    return {
        "user": page["items"][0],
        "events": events,
        "event_limit": 50,
        "coverage": page["coverage"],
    }

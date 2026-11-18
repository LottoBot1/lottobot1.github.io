-- Typer49 – porównanie przypisania zakładów do losowań: stara zasada aplikacji vs nowa.
-- TYLKO ODCZYT – niczego nie zmienia w bazie.
--   stara: najbliższe losowanie z terminarza (wt/czw/sob 22:00), godzina losowania >= chwila zapisania
--          (tak liczyła aplikacja na urządzeniu w Polsce)
--   nowa:  pierwsze losowanie, które faktycznie się odbyło, z godziną > chwila zapisania
--          (tak liczy baza w bet_results i od teraz aplikacja – time.js)
with b as (
  select left(md5(b.user_id::text), 4) as konto, b.created_at,
         (select min(x::date)
            from generate_series((b.created_at at time zone 'Europe/Warsaw')::date,
                                 (b.created_at at time zone 'Europe/Warsaw')::date + 8, interval '1 day') x
           where extract(isodow from x) in (2, 4, 6)
             and ((x::date + time '22:00') at time zone 'Europe/Warsaw') >= b.created_at) as stara,
         (select d.draw_date from public.draws d
           where d.game = 'lotto' and d.draw_time > b.created_at
           order by d.draw_time limit 1) as nowa
  from public.bets b
)
select count(*)                                                            as zakladow,
       count(distinct konto)                                               as kont,
       count(*) filter (where nowa is null)                                as jeszcze_nierozliczone,
       count(*) filter (where nowa is not null and stara = nowa)           as bez_zmian,
       count(*) filter (where nowa is not null and stara is distinct from nowa) as zmieniloby_losowanie,
       coalesce(string_agg(case when nowa is not null and stara is distinct from nowa
                                then konto || ': zapisany ' || to_char(created_at at time zone 'Europe/Warsaw', 'DD.MM.YYYY HH24:MI')
                                     || ', było ' || stara || ', będzie ' || nowa end, ' | '), 'brak') as roznice
from b;

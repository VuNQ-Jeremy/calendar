# Backlog — i18n keys with no static reference

Captured 2026-07-29 from `npm run check:i18n -- --unused` (audit phase 4). **Do not bulk-prune
this list.** It is the output of a *static* scan, and a large share of these keys are reached in
ways no static scan can see:

- **Dynamic prefixes** — `att_*`, `bh_*`, `cat_*`, `cfg_sb_*`, `cfg_tb_*`, `type_*`, `st_*`,
  `feat_*`, `preset_*`, `fc_mode_*` are all composed at the call site
  (`t('type_' + m.type)`, `t('feat_' + f.key + '_title')`, and so on).
- **Keys passed through a variable** — mobile's login does `setError('auth_wrong_creds')` and
  later `t(error)`. Every `auth_*` entry below is suspect for this reason.
- **Plural/branch selection** — `dash_sub_none` / `dash_sub_one` / `dash_sub_many` are picked by
  count.

Pruning deserves its own pass: verify each key by hand, one family at a time, and delete from
**both** locales together.

Since captured: `nav_manage` was hand-verified and deleted (2026-08-07) when the sidebar's one
"Manage" section became five collapsible ones. Its replacements — `nav_teaching`, `nav_grading`,
`nav_learning`, `nav_admin` — will show up as false positives in the next scan for the same reason
`nav_overview` does: section labels are referenced as `tk:` values in the NAV table, not as literal
`t('…')` calls.

83 keys as of 2026-07-29:

```
add                    auth_pw_short          feat_calendar_text     m_notifications
assess_records         auth_wrong_creds       feat_calendar_title    m_timeout
att_absent             auth_wrong_current_pw  feat_classes_text      nav_assessments
att_excused            bh_disruptive          feat_classes_title     nav_config
att_late               bh_other               feat_dashboard_text    nav_feedback
att_present            bh_praise              feat_dashboard_title   nav_homework
att_save               cat_bug                feat_feedback_text     nav_manage
auth_create_account    cat_idea               feat_feedback_title    nav_materials
auth_create_btn        cat_other              feat_homework_text     nav_overview
auth_create_sub        cat_praise             feat_homework_title    nav_people
auth_create_title      cfg_sb_brand           feat_materials_text    preset_cream
auth_enter_email       cfg_sb_ghost           feat_materials_title   preset_dusk
auth_fill_all          cfg_sb_inset           feat_people_text       preset_lavender
auth_fullname_ph       cfg_sb_slim            feat_people_title      preset_meadow
auth_have_account      cfg_tb_dock            hw_search_ph           preset_sky
auth_new_here          cfg_tb_indicator       hw_section_homework    st_done
auth_pw_nomatch        cfg_tb_pill            m_downloaded           st_new
                       dash_sub_many          m_loading              st_reviewed
                       dash_sub_none          m_notif_sub            type_curriculum
                       dash_sub_one           type_link              type_notes
                       fc_mode_flip           type_video             type_worksheet
                       fc_mode_match
                       fc_mode_quiz
                       fc_shuffle
```

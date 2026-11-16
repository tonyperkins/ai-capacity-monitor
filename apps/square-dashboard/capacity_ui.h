#pragma once
#include "capacity_model.h"
#include "touch_calibration.h"
#include <lvgl.h>
#include <functional>

namespace capacity_ui {
using capacity_model::Metric;
using capacity_model::Snapshot;
constexpr uint32_t BG = 0x0b1019, PANEL = 0x151f2d, BORDER = 0x29384b;
constexpr uint32_t TEXT = 0xecf2fa, MUTED = 0x91a4bd, CYAN = 0x59dbef, AMBER = 0xf5c476, RED = 0xff7f88;
constexpr uint32_t VIOLET = 0xb7a3ff, TRACK = 0x1b2838;
// Pages, in swipe order: swipe left for the next, right for the previous.
// Home has one row per provider; Limits lists every reading; Settings holds
// the display controls and Refresh.
enum View { HOME = 0, LIMITS = 1, SETTINGS = 2 };
inline Snapshot snapshot;
inline bool have_data = false, online = false, busy = false;
inline int view = 0, brightness = 100, rotation_degrees = 0;
inline std::function<void()> refresh_action;
inline std::function<void(float)> brightness_action;
inline std::function<void(int,bool)> rotation_action;
inline lv_obj_t* rotation_label = nullptr;
inline lv_obj_t *body = nullptr, *status = nullptr, *refresh_button = nullptr, *modal = nullptr, *brightness_label = nullptr, *issues_button = nullptr;
inline lv_obj_t* dots[3] = {};
inline std::string layout_key, detail_key, detail_provider;
struct Row { std::string key; lv_obj_t *name, *value, *note, *reset, *bar, *time_bar; };
inline std::vector<Row> rows;
// The bundled Montserrat fonts cover ASCII plus the degree sign and bullet.
// Typographic dashes become "-", a middle dot becomes "/", and any other
// character the font lacks becomes "?" instead of an empty box.
inline std::string display_text(std::string text) {
  for (const auto& swap : {std::pair<const char*,const char*>{"\u2014","-"}, {"\u2013","-"}, {"\u2011","-"}, {"\u00b7","/"}}) {
    size_t at=0;
    while ((at=text.find(swap.first,at))!=std::string::npos) { text.replace(at,std::string(swap.first).size(),swap.second); ++at; }
  }
  std::string out;
  for (size_t i=0;i<text.size();) {
    const unsigned char c=text[i];
    const size_t length = c<0x80 ? 1 : c>=0xf0 ? 4 : c>=0xe0 ? 3 : c>=0xc0 ? 2 : 1;
    const auto piece=text.substr(i,length);
    out += (c<0x80 || piece=="\u00b0" || piece=="\u2022") ? piece : std::string("?");
    i+=length;
  }
  return out;
}
inline void render();
inline void update_status();
inline lv_color_t color(uint32_t value) { return lv_color_hex(value); }
inline uint32_t accent(const Metric& m) { return m.attention() ? AMBER : m.kind == "quota" && !m.unlimited && m.value <= 10 ? RED : CYAN; }
inline void box(lv_obj_t* o, int x, int y, int w, int h, uint32_t bg = PANEL, int radius = 12) {
  lv_obj_remove_style_all(o); lv_obj_set_pos(o, x, y); lv_obj_set_size(o, w, h);
  lv_obj_set_style_bg_color(o, color(bg), 0); lv_obj_set_style_bg_opa(o, LV_OPA_COVER, 0);
  lv_obj_set_style_radius(o, radius, 0); lv_obj_set_style_border_width(o, 1, 0);
  lv_obj_set_style_border_color(o, color(BORDER), 0);
  lv_obj_remove_flag(o, LV_OBJ_FLAG_SCROLLABLE);
}
inline lv_obj_t* label(lv_obj_t* parent, const std::string& text, int x, int y, int w, const lv_font_t* font = &lv_font_montserrat_18, uint32_t shade = TEXT) {
  auto* o = lv_label_create(parent); lv_obj_set_pos(o, x, y); lv_obj_set_width(o, w);
  lv_label_set_long_mode(o, LV_LABEL_LONG_DOT); lv_label_set_text(o, display_text(text).c_str());
  lv_obj_set_style_text_font(o, font, 0); lv_obj_set_style_text_color(o, color(shade), 0);
  lv_obj_remove_flag(o, LV_OBJ_FLAG_CLICKABLE);
  return o;
}
inline void set_text(lv_obj_t* obj, const std::string& text) {
  const auto shown=display_text(text);
  if (std::string(lv_label_get_text(obj)) != shown) lv_label_set_text(obj, shown.c_str());
}
inline lv_obj_t* button(lv_obj_t* parent, const char* text, int x, int y, int w, int h, lv_event_cb_t callback, void* data = nullptr) {
  auto* o = lv_button_create(parent); box(o, x, y, w, h);
  auto* l = label(o, text, 0, 0, w, &lv_font_montserrat_16);
  lv_obj_set_style_text_align(l, LV_TEXT_ALIGN_CENTER, 0); lv_obj_align(l, LV_ALIGN_CENTER, 0, 0);
  lv_obj_set_style_bg_color(o, color(BORDER), LV_STATE_PRESSED);
  lv_obj_add_event_cb(o, callback, LV_EVENT_CLICKED, data);
  return o;
}
inline lv_obj_t* bar(lv_obj_t* parent, int x, int y, int w, int h, int percent, uint32_t shade) {
  auto* o = lv_bar_create(parent); lv_obj_set_pos(o,x,y); lv_obj_set_size(o,w,h);
  lv_obj_set_style_bg_color(o, color(BORDER), LV_PART_MAIN); lv_obj_set_style_bg_opa(o, LV_OPA_COVER, LV_PART_MAIN);
  lv_obj_set_style_bg_color(o, color(shade), LV_PART_INDICATOR); lv_bar_set_range(o,0,100);
  lv_bar_set_value(o, percent, LV_ANIM_OFF); return o;
}
inline const Metric* find(const std::string& key) {
  for (const auto& m : snapshot.metrics) if (m.key == key) return &m;
  return nullptr;
}
inline void close_detail(lv_event_t*) { if (modal) lv_obj_delete(modal); modal = nullptr; detail_key.clear(); detail_provider.clear(); }
inline void show_detail(const Metric& m) {
  if (modal) lv_obj_delete(modal);
  detail_provider.clear(); detail_key = m.key;
  modal = lv_obj_create(lv_layer_top()); box(modal,0,0,480,480,BG,0);
  button(modal,"< Back",16,12,104,44,close_detail);
  label(modal,m.provider,16,76,448,&lv_font_montserrat_24);
  label(modal,m.label,16,110,448,&lv_font_montserrat_18,MUTED);
  label(modal,m.display,16,149,448,&lv_font_montserrat_32,accent(m));
  label(modal,capacity_model::state_text(m),16,191,448,&lv_font_montserrat_16,m.attention()?AMBER:MUTED);
  const auto now = ::time(nullptr);
  if (m.kind == "quota" && !m.unlimited) {
    label(modal,"Capacity remaining",16,231,448,&lv_font_montserrat_16,MUTED);
    bar(modal,16,256,448,10,int(m.value),accent(m));
  }
  label(modal,capacity_model::reset_text(m,now),16,285,448,&lv_font_montserrat_18);
  const int time_left = capacity_model::reset_percent(m,now);
  const auto deadline=capacity_model::reset_deadline(m);
  label(modal,deadline.empty()?"Exact reset time not provided":deadline,16,319,448,&lv_font_montserrat_14,MUTED);
  if (time_left >= 0) { label(modal,"Time until reset",16,349,448,&lv_font_montserrat_14,MUTED); bar(modal,16,373,448,8,time_left,VIOLET); }
  std::string age = m.collected && now > m.collected ? "Reading collected " + capacity_model::duration(now-m.collected) + " ago" : "Waiting for the clock to sync";
  label(modal,age,16,398,448,&lv_font_montserrat_14,MUTED);
  const Metric* parent = m.parent.empty() ? nullptr : find(m.parent);
  label(modal,parent?"Counts toward "+parent->label:m.attention()?"The collector could not read this provider just now.":"Read by the collector on your computer.",16,439,448,&lv_font_montserrat_14,MUTED);
}
// Colour for a reading: grey when it is a prior value, red at or under the
// hold line, amber when low, otherwise the normal accent.
inline uint32_t level(const Metric& m) {
  return m.attention() ? MUTED : m.value <= capacity_model::HOLD_PERCENT ? RED : m.value <= capacity_model::LOW_PERCENT ? AMBER : CYAN;
}
inline uint32_t ink(const Metric& m) { return level(m) == CYAN ? TEXT : level(m); }
// Every reading of one provider, with exact reset times.
inline void show_provider(const std::string& id) {
  if (modal) lv_obj_delete(modal);
  detail_key.clear(); detail_provider = id;
  modal = lv_obj_create(lv_layer_top()); box(modal,0,0,480,480,BG,0);
  button(modal,"< Back",16,12,104,44,close_detail);
  auto* list=lv_obj_create(modal); box(list,16,66,448,402,BG,0); lv_obj_set_style_border_width(list,0,0);
  lv_obj_add_flag(list,LV_OBJ_FLAG_SCROLLABLE); lv_obj_set_scroll_dir(list,LV_DIR_VER);
  const auto now = ::time(nullptr);
  int y=0;
  for (const auto& m : snapshot.metrics) {
    if (capacity_model::provider_id(m) != id) continue;
    if (!y) { label(modal,m.provider,136,20,328,&lv_font_montserrat_24); }
    auto* card=lv_obj_create(list); box(card,0,y,448,74);
    label(card,m.label,12,8,330,&lv_font_montserrat_16);
    auto* value=label(card,m.display,330,6,106,&lv_font_montserrat_24,m.kind=="quota"?ink(m):TEXT);
    lv_obj_set_style_text_align(value,LV_TEXT_ALIGN_RIGHT,0);
    const auto deadline=capacity_model::reset_deadline(m);
    label(card,m.attention()?capacity_model::state_text(m)+" / prior value":capacity_model::reset_text(m,now),12,31,424,&lv_font_montserrat_14,m.attention()?AMBER:TEXT);
    label(card,deadline.empty()?"Exact reset time not provided":deadline,12,50,424,&lv_font_montserrat_14,MUTED);
    y+=80;
  }
  if (!y) close_detail(nullptr);
}
// Rows on the Home face open their provider's page.
inline std::vector<std::string> tap_ids;
inline void tap_clicked(lv_event_t* e) {
  const auto index = reinterpret_cast<uintptr_t>(lv_event_get_user_data(e));
  if (index < tap_ids.size()) show_provider(tap_ids[index]);
}
inline lv_obj_t* tap_area(lv_obj_t* parent,int x,int y,int w,int h,const std::string& id) {
  auto* o=lv_obj_create(parent); box(o,x,y,w,h);
  lv_obj_add_flag(o,LV_OBJ_FLAG_CLICKABLE);
  lv_obj_set_style_bg_color(o,color(BORDER),LV_STATE_PRESSED);
  lv_obj_add_event_cb(o,tap_clicked,LV_EVENT_CLICKED,reinterpret_cast<void*>(uintptr_t(tap_ids.size())));
  tap_ids.push_back(id);
  return o;
}
inline void row_clicked(lv_event_t* e) {
  const auto index = reinterpret_cast<uintptr_t>(lv_event_get_user_data(e));
  if (index < rows.size()) if (auto* m = find(rows[index].key)) show_detail(*m);
}
inline void show_issues(lv_event_t*) {
  if (modal) lv_obj_delete(modal);
  detail_key.clear(); detail_provider.clear();
  modal=lv_obj_create(lv_layer_top());box(modal,0,0,480,480,BG,0);
  button(modal,"< Back",16,12,104,44,close_detail);
  auto* list=lv_obj_create(modal);box(list,16,77,448,387,BG,0);
  lv_obj_add_flag(list,LV_OBJ_FLAG_SCROLLABLE);lv_obj_set_scroll_dir(list,LV_DIR_VER);
  label(list,"Readings need attention",0,0,448,&lv_font_montserrat_24);
  int y=45;
  for (const auto& issue : snapshot.issues) {
    auto* text=label(list,issue,0,y,436,&lv_font_montserrat_16,AMBER);
    lv_label_set_long_mode(text,LV_LABEL_LONG_WRAP);lv_obj_update_layout(text);
    y+=lv_obj_get_height(text)+24;
  }
}
inline void refresh_clicked(lv_event_t*) { if (!busy && refresh_action) refresh_action(); }
inline void show_view(int next) {
  view = std::max(int(HOME),std::min(int(SETTINGS),next));
  layout_key.clear(); render();
}
inline void slider_changed(lv_event_t* e) {
  brightness = lv_slider_get_value(static_cast<lv_obj_t*>(lv_event_get_target(e)));
  if (brightness_label) set_text(brightness_label,std::to_string(brightness)+"%");
  if (brightness_action) brightness_action(brightness/100.0f);
}
inline void apply_rotation(int angle,bool save) {
  angle=(angle%360+360)%360;
  if(angle%90)angle=0;
  rotation_degrees=angle;
  if(rotation_action)rotation_action(angle,save);
  if(rotation_label)set_text(rotation_label,std::to_string(angle)+" deg");
}
inline void configure_rotation(int saved,std::function<void(int,bool)> action) {
  rotation_action=std::move(action);apply_rotation(saved,false);
}
inline void rotate_clicked(lv_event_t*) {apply_rotation(rotation_degrees+90,true);}

// Calibration captures raw controller samples, independent of the currently
// incorrect LVGL mapping. Only the final Done button uses the new mapping.
inline std::function<void()> calibration_prepare;
inline std::function<void(const capacity_touch::Calibration&,bool)> calibration_apply;
inline std::array<capacity_touch::Point,5> calibration_samples;
inline capacity_touch::Calibration calibration_result;
inline int calibration_stage=-1;
inline int calibration_return_rotation=0;
inline bool calibration_capturing=false;
inline double calibration_xsum=0,calibration_ysum=0;
inline unsigned calibration_sample_count=0;
inline lv_obj_t* calibration_text=nullptr;
inline void calibration_target() {
  if(modal)lv_obj_delete(modal);
  detail_key.clear();
  modal=lv_obj_create(lv_layer_top());box(modal,0,0,480,480,BG,0);
  const bool top_target=calibration_stage==2;
  label(modal,"Touch calibration",16,top_target?90:12,448,&lv_font_montserrat_24);
  if(calibration_stage>=0 && calibration_stage<5) {
    label(modal,"Tap the center of the target, then lift.",16,top_target?132:52,448,&lv_font_montserrat_16,MUTED);
    const auto p=capacity_touch::targets[calibration_stage];
    auto* circle=lv_obj_create(modal);box(circle,int(p.x)-19,int(p.y)-19,38,38,PANEL,19);
    lv_obj_set_style_border_color(circle,color(CYAN),0);lv_obj_set_style_border_width(circle,2,0);
    auto* h=lv_obj_create(modal);box(h,int(p.x)-28,int(p.y)-1,56,2,CYAN,0);
    auto* v=lv_obj_create(modal);box(v,int(p.x)-1,int(p.y)-28,2,56,CYAN,0);
    auto* dot=lv_obj_create(modal);box(dot,int(p.x)-3,int(p.y)-3,6,6,TEXT,3);
    // Instructions avoid the top/bottom targets themselves.
    calibration_text=label(modal,"Target "+std::to_string(calibration_stage+1)+" of 5",16,top_target?174:118,448,&lv_font_montserrat_18);
  } else {
    label(modal,"The taps did not line up.",16,160,448,&lv_font_montserrat_24,AMBER);
    label(modal,"Tap anywhere to try again.",16,211,448,&lv_font_montserrat_18,MUTED);
  }
}
inline void start_calibration(lv_event_t* = nullptr) {
  if(calibration_stage==-1)calibration_return_rotation=rotation_degrees;
  apply_rotation(0,false);
  if(calibration_prepare)calibration_prepare();
  calibration_stage=0;calibration_capturing=false;calibration_sample_count=0;
  calibration_target();
}
inline void calibration_touch(int x,int y) {
  if(calibration_stage==-2){start_calibration();return;}
  if(calibration_stage<0 || calibration_stage>=5)return;
  calibration_capturing=true;calibration_xsum=x;calibration_ysum=y;calibration_sample_count=1;
  if(calibration_text)set_text(calibration_text,"Lift your finger to continue");
}
inline void calibration_update(int x,int y) {
  if(calibration_capturing && calibration_sample_count<32) {
    calibration_xsum+=x;calibration_ysum+=y;++calibration_sample_count;
  }
}
inline void calibration_done(lv_event_t*) {
  if(calibration_apply)calibration_apply(calibration_result,true);
  calibration_stage=-1;calibration_capturing=false;calibration_text=nullptr;
  close_detail(nullptr);
  apply_rotation(calibration_return_rotation,false);
}
inline void calibration_release() {
  if(!calibration_capturing||!calibration_sample_count)return;
  calibration_capturing=false;
  calibration_samples[calibration_stage]={calibration_xsum/calibration_sample_count,calibration_ysum/calibration_sample_count};
  if(++calibration_stage<5){calibration_target();return;}
  calibration_result=capacity_touch::solve(calibration_samples);
  if(!calibration_result.valid){calibration_stage=-2;calibration_target();return;}
  if(calibration_apply)calibration_apply(calibration_result,false);
  lv_obj_clean(modal);calibration_text=nullptr;
  label(modal,"Check the new mapping",16,52,448,&lv_font_montserrat_24);
  auto* help=label(modal,"Tap Done where it is drawn. This saves the calibration.",16,112,448,&lv_font_montserrat_18,MUTED);
  lv_label_set_long_mode(help,LV_LABEL_LONG_WRAP);
  label(modal,"If it is still off, use Start over.",16,176,448,&lv_font_montserrat_16,MUTED);
  button(modal,"Start over",16,288,448,52,start_calibration);
  button(modal,"Done",128,382,224,58,calibration_done);
}
inline void configure_touch_calibration(const std::array<int,8>& stored,std::function<void()> prepare,
    std::function<void(const capacity_touch::Calibration&,bool)> apply) {
  calibration_prepare=std::move(prepare);calibration_apply=std::move(apply);
  const auto c=capacity_touch::Calibration::restore(stored);
  if(c.valid){calibration_result=c;calibration_apply(c,false);}
  else start_calibration();
}

inline void render_settings() {
  label(body,"Display settings",0,4,448,&lv_font_montserrat_24);
  label(body,"Brightness",0,62,300,&lv_font_montserrat_20);
  brightness_label = label(body,std::to_string(brightness)+"%",342,62,102,&lv_font_montserrat_20,CYAN);
  auto* slider = lv_slider_create(body); lv_obj_set_pos(slider,12,119); lv_obj_set_size(slider,416,18);
  lv_slider_set_range(slider,10,100); lv_slider_set_value(slider,brightness,LV_ANIM_OFF);
  lv_obj_set_style_bg_color(slider,color(CYAN),LV_PART_INDICATOR); lv_obj_set_style_bg_color(slider,color(CYAN),LV_PART_KNOB);
  lv_obj_add_event_cb(slider,slider_changed,LV_EVENT_VALUE_CHANGED,nullptr);
  // Dragging the slider sideways must not turn the page.
  lv_obj_remove_flag(slider,LV_OBJ_FLAG_GESTURE_BUBBLE);
  label(body,"Orientation",0,158,300,&lv_font_montserrat_20);
  rotation_label=label(body,std::to_string(rotation_degrees)+" deg",328,158,116,&lv_font_montserrat_20,CYAN);
  button(body,"Rotate 90 deg clockwise",0,192,448,48,rotate_clicked);
  button(body,"Calibrate touch",0,258,448,48,start_calibration);
  refresh_button=button(body,"Refresh now",0,324,448,48,refresh_clicked);
  if (busy) lv_obj_add_state(refresh_button,LV_STATE_DISABLED);
  auto* help=label(body,"Refresh fetches the collector's latest snapshot. It does not start a new reading.",0,384,448,&lv_font_montserrat_14,MUTED);
  lv_label_set_long_mode(help,LV_LABEL_LONG_WRAP);
  help=label(body,"Orientation is saved. Touch calibration stays aligned when you rotate.",0,432,448,&lv_font_montserrat_14,MUTED);
  lv_label_set_long_mode(help,LV_LABEL_LONG_WRAP);
  label(body,"Swipe left or right to change page / 480 x 480",0,480,448,&lv_font_montserrat_14,MUTED);
}
inline void update_rows() {
  const auto now = ::time(nullptr);
  for (auto& row : rows) {
    auto* m = find(row.key); if (!m) continue;
    set_text(row.name,m->provider + (m->kind == "quota" ? " / " + m->label : ""));
    set_text(row.value,m->display);
    if(m->kind=="quota") {
      const auto* font=m->unlimited?&lv_font_montserrat_20:&lv_font_montserrat_24;
      lv_obj_set_style_text_font(row.value,font,0);
      lv_obj_set_height(row.value,font->line_height);
    }
    lv_obj_set_style_text_color(row.value,color(accent(*m)),0);
    set_text(row.note,m->attention()?capacity_model::state_text(*m)+" / prior value":m->kind=="quota"?(m->unlimited?"No fixed cap":"remaining"):m->label);
    set_text(row.reset,m->kind=="quota"?capacity_model::reset_text(*m,now):"Tap for details");
    if(row.time_bar) {
      const int percent=capacity_model::reset_percent(*m,now);
      if(percent<0)lv_obj_add_flag(row.time_bar,LV_OBJ_FLAG_HIDDEN);
      else {lv_obj_remove_flag(row.time_bar,LV_OBJ_FLAG_HIDDEN);lv_bar_set_value(row.time_bar,percent,LV_ANIM_OFF);}
    }
    if (row.bar) {
      lv_bar_set_value(row.bar,m->unlimited?100:int(m->value),LV_ANIM_OFF);
      lv_obj_set_style_bg_color(row.bar,color(accent(*m)),LV_PART_INDICATOR);
    }
  }
}
// Home: one row per provider with two fixed columns, the short window
// (session, 5-hour or daily) and the long one (weekly). Each cell shows percent
// remaining, the window and its reset countdown, a capacity bar, and a thin
// violet bar that fills as the window runs toward its reset. A provider with
// no short window leaves that cell empty.
inline void plain(lv_obj_t* o) { lv_obj_set_style_border_width(o,0,0); lv_obj_remove_flag(o,LV_OBJ_FLAG_CLICKABLE); }
inline void home_cell(lv_obj_t* card,int x,const Metric& m,time_t now) {
  constexpr int W=164, SIDE=66;  // SIDE fits the widest countdown, "23h 59m"
  label(card,m.display,x,5,W-SIDE,&lv_font_montserrat_32,ink(m));
  auto* window=label(card,m.attention()?"prior":capacity_model::window_name(m.window_ms),x+W-SIDE,8,SIDE,&lv_font_montserrat_14,m.attention()?AMBER:MUTED);
  const bool timed=m.reset && now>1700000000;
  auto* countdown=label(card,!timed?"":m.reset>now?(m.reset-now<60?"<1m":capacity_model::duration(m.reset-now)):"due",x+W-SIDE,25,SIDE,&lv_font_montserrat_14);
  // One fixed line each, right-aligned to the end of the bar, so a long
  // countdown can never wrap onto the bar.
  for (auto* text : {window,countdown}) {
    lv_obj_set_height(text,lv_font_montserrat_14.line_height);
    lv_obj_set_style_text_align(text,LV_TEXT_ALIGN_RIGHT,0);
  }
  bar(card,x,49,W,8,int(m.value),level(m));
  // Under it, how far through the window we are: empty just after a reset,
  // full when the next reset is due.
  const int left=capacity_model::reset_percent(m,now);
  if (left>=0 && !m.attention()) bar(card,x,61,W,4,100-left,VIOLET);
}
inline void render_home(const std::vector<capacity_model::Provider>& list, time_t now) {
  const int pitch=std::max(83,std::min(110,418/int(list.size())));
  for (size_t i=0;i<list.size();++i) {
    const auto& p=list[i];
    auto* card=tap_area(body,0,int(i)*pitch,448,pitch-5,p.id);
    label(card,p.name,10,8,88,&lv_font_montserrat_18);
    // Scoped limits, such as a model-specific weekly cap, sit under the name.
    for (size_t j=0;j<p.extras.size() && j<2;++j) {
      const auto& m=*p.extras[j];
      label(card,capacity_model::short_name(m)+" "+m.display,10,33+int(j)*17,88,&lv_font_montserrat_14,level(m)==CYAN?MUTED:level(m));
    }
    if (p.quick) home_cell(card,100,*p.quick,now);
    if (p.main) home_cell(card,274,*p.main,now);
  }
}
inline void message(const std::string& title,const std::string& detail) {
  label(body,title,0,72,448,&lv_font_montserrat_24);
  label(body,detail,0,123,448,&lv_font_montserrat_18,MUTED);
}
inline void render() {
  const auto now = ::time(nullptr);
  std::vector<const Metric*> selected;
  std::string key = std::to_string(view)+":"+std::to_string(have_data);
  if (view == LIMITS) {
    // Rows are created once per set of keys and then updated in place.
    selected = capacity_model::select(snapshot,"quota");
    for (const auto* m : capacity_model::select(snapshot,"credit")) selected.push_back(m);
    for (const auto* m : selected) key += ":"+m->key;
  } else if (view == HOME) {
    // Redrawn only when something it shows has changed, or once a minute so
    // the countdowns and time ticks keep moving.
    for (const auto& m : snapshot.metrics) key += ":"+m.key+"="+std::to_string(int(m.value))+m.state+std::to_string((long long)m.reset);
    key += ":"+std::to_string((long long)(now/60));
  }
  if (layout_key != key) {
    layout_key = key; rows.clear(); tap_ids.clear(); brightness_label = nullptr; rotation_label=nullptr; refresh_button=nullptr;
    lv_obj_clean(body); lv_obj_scroll_to_y(body,0,LV_ANIM_OFF);
    if (view == SETTINGS) render_settings();
    else if (!have_data) message("Connecting to your data","Waiting for the collector's snapshot.");
    else if (view == LIMITS) {
      if (selected.empty()) message("No limits to show","The collector has not reported any limits yet.");
      else label(body,"All limits",0,0,448,&lv_font_montserrat_20,MUTED);
      for (size_t i=0;i<selected.size();++i) {
        const bool quota = selected[i]->kind == "quota";
        auto* card=lv_obj_create(body); box(card,0,34+int(i)*98,448,90);
        lv_obj_add_flag(card,LV_OBJ_FLAG_CLICKABLE);
        lv_obj_add_event_cb(card,row_clicked,LV_EVENT_CLICKED,reinterpret_cast<void*>(i));
        Row row; row.key=selected[i]->key;
        row.name=label(card,"",12,10,424,&lv_font_montserrat_18);
        row.value=label(card,"",316,29,120,&lv_font_montserrat_24,CYAN);
        lv_obj_set_style_text_align(row.value,LV_TEXT_ALIGN_RIGHT,0);
        row.note=label(card,"",12,34,288,&lv_font_montserrat_14,MUTED);
        row.bar=quota?bar(card,12,58,424,5,0,CYAN):nullptr;
        row.reset=label(card,"",12,69,316,&lv_font_montserrat_14,MUTED);
        row.time_bar=quota?bar(card,348,76,88,4,0,VIOLET):nullptr;
        // Fixed line heights make ellipsis effective instead of allowing labels to wrap.
        for(auto* text : {row.name,row.value,row.note,row.reset})
          lv_obj_set_height(text,lv_obj_get_style_text_font(text,LV_PART_MAIN)->line_height);
        rows.push_back(row);
      }
    } else {
      const auto list = capacity_model::providers(snapshot);
      if (list.empty()) message("No limits to show","The collector has not reported any limits yet.");
      else render_home(list,now);
    }
    for (int i=0;i<3;++i) {
      lv_obj_set_style_bg_color(dots[i],color(i==view?CYAN:BORDER),0);
      lv_obj_set_width(dots[i],i==view?20:8);
    }
  }
  update_rows(); update_status();
}
// Called on a timer: refreshes countdowns and redraws a face that has gone stale.
inline void tick() { render(); }
inline void update_status() {
  if (!status) return;
  const auto now = ::time(nullptr);
  std::string text;
  uint32_t shade = MUTED;
  if (busy) text="Checking the collector...";
  else if (!have_data) text=online?"Connected / waiting for readings":"Waiting for the collector";
  else {
    const auto age = now > snapshot.collected ? now-snapshot.collected : 0;
    text = !online?"Offline / showing last data":age>2400?"Older snapshot": "Connected";
    if (now > 1700000000) text += " / collected " + capacity_model::duration(age) + " ago";
    else text += " / clock syncing";
    shade=(!online || age>2400)?AMBER:MUTED;
  }
  set_text(status,text);lv_obj_set_style_text_color(status,color(shade),0);
  if (issues_button) {
    if (snapshot.issue_count) {
      lv_obj_remove_flag(issues_button,LV_OBJ_FLAG_HIDDEN);
      set_text(lv_obj_get_child(issues_button,0),std::to_string(snapshot.issue_count)+(snapshot.issue_count==1?" issue":" issues"));
    } else lv_obj_add_flag(issues_button,LV_OBJ_FLAG_HIDDEN);
  }
  if (view==LIMITS) update_rows();
}
inline void set_busy(bool value) {
  busy=value;
  if (refresh_button) { if (value) lv_obj_add_state(refresh_button,LV_STATE_DISABLED); else lv_obj_remove_state(refresh_button,LV_STATE_DISABLED); }
  update_status();
}
inline void connection_failed() { online=false;set_busy(false); }
inline bool accept_snapshot(JsonObject root) {
  Snapshot next;
  if (!capacity_model::parse(root,next)) return false;
  snapshot=std::move(next);have_data=true;online=true;busy=false;
  if (refresh_button) lv_obj_remove_state(refresh_button,LV_STATE_DISABLED);
  render();
  if (modal && !detail_key.empty()) {
    const auto key=detail_key;
    if (const auto* m=find(key)) show_detail(*m);
    else close_detail(nullptr);
  } else if (modal && !detail_provider.empty()) { const auto id=detail_provider; show_provider(id); }
  return true;
}
inline void set_brightness_level(float value) {
  if (!std::isfinite(value)) return;
  brightness=std::max(10,std::min(100,int(std::lround(value*100))));
  if (brightness_label) set_text(brightness_label,std::to_string(brightness)+"%");
}
// Swipe left/right turns the page. On a detail page a swipe right goes back.
// Touch calibration ignores swipes.
inline void swipe(lv_dir_t dir) {
  if (modal) { if (dir==LV_DIR_RIGHT && calibration_stage==-1) close_detail(nullptr); return; }
  if (dir==LV_DIR_LEFT && view<SETTINGS) show_view(view+1);
  else if (dir==LV_DIR_RIGHT && view>HOME) show_view(view-1);
}
inline void gesture(lv_event_t*) {
  auto* indev=lv_indev_active(); if (!indev) return;
  const auto dir=lv_indev_get_gesture_dir(indev);
  if (dir!=LV_DIR_LEFT && dir!=LV_DIR_RIGHT) return;
  // The finger is still down: do not let its release click whatever is drawn next.
  lv_indev_wait_release(indev);
  swipe(dir);
}
inline void begin(std::function<void()> refresh, std::function<void(float)> set_brightness) {
  refresh_action=std::move(refresh);brightness_action=std::move(set_brightness);
  auto* root=lv_screen_active();box(root,0,0,480,480,BG,0);
  // A status strip, the body, then page dots. The strip is a button only
  // while there are issues: tapping it lists them.
  status=label(root,"Connecting...",16,9,330,&lv_font_montserrat_14,MUTED);
  issues_button=lv_obj_create(root);box(issues_button,0,0,480,34,BG,0);plain(issues_button);
  lv_obj_set_style_bg_opa(issues_button,LV_OPA_TRANSP,0);
  lv_obj_add_flag(issues_button,LV_OBJ_FLAG_CLICKABLE);
  lv_obj_add_event_cb(issues_button,show_issues,LV_EVENT_CLICKED,nullptr);
  auto* count=label(issues_button,"",330,9,134,&lv_font_montserrat_14,AMBER);
  lv_obj_set_style_text_align(count,LV_TEXT_ALIGN_RIGHT,0);
  lv_obj_add_flag(issues_button,LV_OBJ_FLAG_HIDDEN);
  body=lv_obj_create(root);box(body,16,34,448,418,BG,0);lv_obj_set_style_border_width(body,0,0);
  lv_obj_add_flag(body,LV_OBJ_FLAG_SCROLLABLE);lv_obj_set_scroll_dir(body,LV_DIR_VER);
  lv_obj_set_scrollbar_mode(body,LV_SCROLLBAR_MODE_AUTO);
  auto* strip=lv_obj_create(root);box(strip,190,462,100,8,BG,0);plain(strip);
  lv_obj_set_layout(strip,LV_LAYOUT_FLEX);lv_obj_set_flex_flow(strip,LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(strip,LV_FLEX_ALIGN_CENTER,LV_FLEX_ALIGN_CENTER,LV_FLEX_ALIGN_CENTER);
  lv_obj_set_style_pad_column(strip,8,0);
  for (int i=0;i<3;++i) { dots[i]=lv_obj_create(strip);box(dots[i],0,0,8,8,BORDER,4);plain(dots[i]); }
  // Gestures stop at the screen and at the layer that holds detail pages.
  for (auto* target : {root,lv_layer_top()}) {
    lv_obj_remove_flag(target,LV_OBJ_FLAG_GESTURE_BUBBLE);
    lv_obj_add_event_cb(target,gesture,LV_EVENT_GESTURE,nullptr);
  }
  render();
}
}

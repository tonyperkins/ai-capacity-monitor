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
// Views, in navigation order. Rings and Dispatch summarise each provider;
// Limits lists every reading; Settings holds the display controls.
enum View { RINGS = 0, DISPATCH = 1, LIMITS = 2, SETTINGS = 3 };
inline Snapshot snapshot;
inline bool have_data = false, online = false, busy = false;
inline int view = 0, brightness = 100, rotation_degrees = 0;
inline std::function<void()> refresh_action;
inline std::function<void(float)> brightness_action;
inline std::function<void(int,bool)> rotation_action;
inline lv_obj_t* rotation_label = nullptr;
inline lv_obj_t *body = nullptr, *status = nullptr, *refresh_button = nullptr, *modal = nullptr, *brightness_label = nullptr, *issues_button = nullptr;
inline lv_obj_t* nav[4] = {};
inline std::string layout_key, detail_key;
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
inline void close_detail(lv_event_t*) { if (modal) lv_obj_delete(modal); modal = nullptr; detail_key.clear(); }
inline void show_detail(const Metric& m) {
  if (modal) lv_obj_delete(modal);
  detail_key = m.key;
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
// Tappable areas on the Rings and Dispatch faces open a reading's detail page.
inline std::vector<std::string> tap_keys;
inline void tap_clicked(lv_event_t* e) {
  const auto index = reinterpret_cast<uintptr_t>(lv_event_get_user_data(e));
  if (index < tap_keys.size()) if (auto* m = find(tap_keys[index])) show_detail(*m);
}
inline lv_obj_t* tap_area(lv_obj_t* parent,int x,int y,int w,int h,const std::string& key,uint32_t bg=PANEL,int radius=12) {
  auto* o=lv_obj_create(parent); box(o,x,y,w,h,bg,radius);
  lv_obj_add_flag(o,LV_OBJ_FLAG_CLICKABLE);
  lv_obj_add_event_cb(o,tap_clicked,LV_EVENT_CLICKED,reinterpret_cast<void*>(uintptr_t(tap_keys.size())));
  tap_keys.push_back(key);
  return o;
}
inline void row_clicked(lv_event_t* e) {
  const auto index = reinterpret_cast<uintptr_t>(lv_event_get_user_data(e));
  if (index < rows.size()) if (auto* m = find(rows[index].key)) show_detail(*m);
}
inline void show_issues(lv_event_t*) {
  if (modal) lv_obj_delete(modal);
  detail_key.clear();
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
inline void navigate(lv_event_t* e) {
  view = int(reinterpret_cast<uintptr_t>(lv_event_get_user_data(e)));
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
  label(body,"Orientation",0,158,300,&lv_font_montserrat_20);
  rotation_label=label(body,std::to_string(rotation_degrees)+" deg",328,158,116,&lv_font_montserrat_20,CYAN);
  button(body,"Rotate 90 deg clockwise",0,192,448,48,rotate_clicked);
  button(body,"Calibrate touch",0,258,448,48,start_calibration);
  auto* help=label(body,"Orientation is saved. Touch calibration stays aligned when you rotate.",0,338,448,&lv_font_montserrat_16,MUTED);
  lv_label_set_long_mode(help,LV_LABEL_LONG_WRAP);
  help=label(body,"Refresh fetches the collector's latest snapshot. It does not start a new reading.",0,420,448,&lv_font_montserrat_14,MUTED);
  lv_label_set_long_mode(help,LV_LABEL_LONG_WRAP);
  label(body,"480 x 480 / LVGL touch dashboard",0,488,448,&lv_font_montserrat_14,MUTED);
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
// Rings: one arc per provider showing its tightest long-window limit, drawn
// clockwise from 12 o'clock over three quarters of a circle. A violet dot on
// each ring marks the time left in that limit's window on the same scale, so
// an arc that reaches past its dot has capacity to spare and one that stops
// short is being used faster than the window allows.
inline void render_rings(const std::vector<capacity_model::Provider>& list, time_t now) {
  constexpr int CX=224, CY=163, OUTER=148, PITCH=22, WIDTH=14;
  const size_t count=std::min<size_t>(list.size(),5);
  size_t tight=0;
  for (size_t i=0;i<count;++i) {
    const auto& p=list[i]; const auto& m=*p.primary; const int r=OUTER-int(i)*PITCH;
    if (m.value<list[tight].primary->value) tight=i;
    auto* arc=lv_arc_create(body); lv_obj_remove_style_all(arc);
    lv_obj_remove_flag(arc,LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_pos(arc,CX-r-WIDTH/2,CY-r-WIDTH/2); lv_obj_set_size(arc,2*r+WIDTH,2*r+WIDTH);
    lv_arc_set_rotation(arc,270); lv_arc_set_bg_angles(arc,0,270);
    lv_arc_set_range(arc,0,100); lv_arc_set_value(arc,int(m.value));
    for (auto part : {LV_PART_MAIN,LV_PART_INDICATOR}) {
      lv_obj_set_style_arc_width(arc,WIDTH,part); lv_obj_set_style_arc_rounded(arc,true,part);
      lv_obj_set_style_arc_opa(arc,LV_OPA_COVER,part);
    }
    lv_obj_set_style_arc_color(arc,color(TRACK),LV_PART_MAIN);
    lv_obj_set_style_arc_color(arc,color(accent(m)),LV_PART_INDICATOR);
    const int left=capacity_model::reset_percent(m,now);
    if (left>=0) {
      const double angle=left*270.0/100*3.14159265358979/180;
      auto* dot=lv_obj_create(body);
      box(dot,CX+int(std::lround(r*std::sin(angle)))-6,CY-int(std::lround(r*std::cos(angle)))-6,12,12,VIOLET,6);
      lv_obj_set_style_border_color(dot,color(BG),0); lv_obj_set_style_border_width(dot,2,0);
      lv_obj_remove_flag(dot,LV_OBJ_FLAG_CLICKABLE);
    }
    // Labels sit in the empty quarter, level with the start of their ring:
    // provider, percent left, then the short-window limit if there is one.
    const int y=CY-r-8;
    auto* name=label(body,p.name,0,y,122,&lv_font_montserrat_14,MUTED);
    lv_obj_set_style_text_align(name,LV_TEXT_ALIGN_RIGHT,0);
    auto* value=label(body,std::to_string(int(m.value)),124,y,30,&lv_font_montserrat_14,accent(m)==CYAN?TEXT:accent(m));
    lv_obj_set_style_text_align(value,LV_TEXT_ALIGN_RIGHT,0);
    if (p.quick) label(body,capacity_model::window_name(p.quick->window_ms)+" "+std::to_string(int(p.quick->value)),160,y,50,&lv_font_montserrat_14,p.quick->value<=capacity_model::HOLD_PERCENT?RED:MUTED);
  }
  const auto& p=list[tight]; const auto& m=*p.primary;
  const int inner=OUTER-int(count-1)*PITCH-WIDTH/2-4;
  auto* hub=tap_area(body,CX-inner,CY-inner,2*inner,2*inner,m.key,BG,inner);
  lv_obj_set_style_border_width(hub,0,0);
  for (auto* text : {label(hub,p.name,0,inner-36,2*inner,&lv_font_montserrat_14,MUTED),
                     label(hub,m.display,0,inner-19,2*inner,&lv_font_montserrat_32,accent(m)==CYAN?TEXT:accent(m)),
                     label(hub,"left",0,inner+17,2*inner,&lv_font_montserrat_14,MUTED)})
    lv_obj_set_style_text_align(text,LV_TEXT_ALIGN_CENTER,0);
  auto* dot=lv_obj_create(body); box(dot,352,2,12,12,VIOLET,6); lv_obj_set_style_border_width(dot,0,0);
  lv_obj_remove_flag(dot,LV_OBJ_FLAG_CLICKABLE);
  label(body,"time left",370,0,78,&lv_font_montserrat_14,MUTED);
  label(body,"Tightest",0,272,108,&lv_font_montserrat_14,MUTED);
  auto* what=label(body,m.label,0,290,134,&lv_font_montserrat_14);
  lv_label_set_long_mode(what,LV_LABEL_LONG_WRAP); lv_obj_set_height(what,34);
  const bool timed=m.reset && now>1700000000;
  auto* when=label(body,timed?(m.reset>now?"Resets in":"Reset"):"Reset time",340,272,108,&lv_font_montserrat_14,MUTED);
  auto* span=label(body,timed?(m.reset>now?capacity_model::duration(m.reset-now):"due"):"unknown",320,290,128,&lv_font_montserrat_18);
  for (auto* text : {when,span}) lv_obj_set_style_text_align(text,LV_TEXT_ALIGN_RIGHT,0);
}
// Dispatch: where to send the next job. See capacity_model::dispatch for the order.
inline void render_dispatch(const std::vector<capacity_model::Pick>& picks, time_t now) {
  auto refill=[&](const Metric& m) {
    return m.reset && now>1700000000 ? (m.reset>now?"refills in "+capacity_model::duration(m.reset-now):std::string("refill due")) : std::string("no reset time");
  };
  const auto& top=picks[0]; const auto& first=*top.provider.primary;
  const uint32_t ink=top.hold?TEXT:BG;
  // When even the best provider is on hold there is nothing to recommend, so
  // the hero says so and every provider is listed below it.
  lv_obj_t* hero;
  if (top.hold) { hero=lv_obj_create(body); box(hero,0,0,448,100,PANEL,14); }
  else hero=tap_area(body,0,0,448,100,first.key,CYAN,14);
  label(hero,top.hold?"EVERYTHING IS ON HOLD":"SPEND FIRST",16,9,300,&lv_font_montserrat_14,top.hold?AMBER:ink);
  label(hero,top.hold?std::string("Hold new work"):top.provider.name,16,27,270,&lv_font_montserrat_32,ink);
  label(hero,top.hold?"Every plan has a limit at or under 10%":first.display+" left, "+refill(first),16,71,416,&lv_font_montserrat_14,ink);
  if (!top.hold && top.spare>=0) {
    char rate[24]; snprintf(rate,sizeof(rate),"%.1f%%",top.spare);
    for (auto* text : {label(hero,rate,296,20,136,&lv_font_montserrat_24,ink),label(hero,"spare per hour",296,50,136,&lv_font_montserrat_14,ink)})
      lv_obj_set_style_text_align(text,LV_TEXT_ALIGN_RIGHT,0);
  }
  const size_t skip=top.hold?0:1;
  for (size_t i=skip;i<picks.size();++i) {
    const auto& pick=picks[i]; const auto& m=*pick.provider.primary;
    auto* card=tap_area(body,0,108+int(i-skip)*54,448,50,m.key);
    label(card,std::to_string(i+1),12,13,22,&lv_font_montserrat_20,MUTED);
    label(card,pick.provider.name,40,5,180,&lv_font_montserrat_18);
    auto* note=label(card,pick.hold?"On hold / "+m.display+" left":m.display+" / "+refill(m),222,8,214,&lv_font_montserrat_14,pick.hold?AMBER:MUTED);
    lv_obj_set_style_text_align(note,LV_TEXT_ALIGN_RIGHT,0);
    bar(card,40,36,396,5,int(m.value),accent(m));
    // The hold line: at or under 10%, stop sending new work.
    auto* hold=lv_obj_create(card); box(hold,40+396*int(capacity_model::HOLD_PERCENT)/100,33,2,11,AMBER,0);
    lv_obj_set_style_border_width(hold,0,0); lv_obj_remove_flag(hold,LV_OBJ_FLAG_CLICKABLE);
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
  } else if (view == RINGS || view == DISPATCH) {
    // These faces are redrawn only when something they show has changed, or
    // every ten minutes so countdowns and the time-left dots keep moving.
    for (const auto& m : snapshot.metrics) key += ":"+m.key+"="+std::to_string(int(m.value))+m.state+std::to_string((long long)m.reset);
    key += ":"+std::to_string((long long)(now/600));
  }
  if (layout_key != key) {
    layout_key = key; rows.clear(); tap_keys.clear(); brightness_label = nullptr; rotation_label=nullptr;
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
      else if (view == RINGS) render_rings(list,now);
      else render_dispatch(capacity_model::dispatch(snapshot,now),now);
    }
    for (int i=0;i<4;++i) {
      lv_obj_set_style_bg_color(nav[i],color(i==view?CYAN:PANEL),0);
      auto* l=lv_obj_get_child(nav[i],0);lv_obj_set_style_text_color(l,color(i==view?BG:MUTED),0);
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
  }
  return true;
}
inline void set_brightness_level(float value) {
  if (!std::isfinite(value)) return;
  brightness=std::max(10,std::min(100,int(std::lround(value*100))));
  if (brightness_label) set_text(brightness_label,std::to_string(brightness)+"%");
}
inline void begin(std::function<void()> refresh, std::function<void(float)> set_brightness) {
  refresh_action=std::move(refresh);brightness_action=std::move(set_brightness);
  auto* root=lv_screen_active();box(root,0,0,480,480,BG,0);
  label(root,"Capacity",16,15,310,&lv_font_montserrat_24);
  refresh_button=button(root,"Refresh",368,10,96,44,refresh_clicked);
  issues_button=button(root,"Issues",174,10,136,44,show_issues);
  lv_obj_set_style_bg_color(issues_button,color(0x3a291a),0);
  lv_obj_set_style_text_color(lv_obj_get_child(issues_button,0),color(AMBER),0);
  lv_obj_add_flag(issues_button,LV_OBJ_FLAG_HIDDEN);
  status=label(root,"Connecting...",16,57,448,&lv_font_montserrat_14,MUTED);
  body=lv_obj_create(root);box(body,16,85,448,326,BG,0);lv_obj_set_style_border_width(body,0,0);
  lv_obj_add_flag(body,LV_OBJ_FLAG_SCROLLABLE);lv_obj_set_scroll_dir(body,LV_DIR_VER);
  lv_obj_set_scrollbar_mode(body,LV_SCROLLBAR_MODE_AUTO);
  const char* names[]={"Rings","Dispatch","Limits","Settings"};
  for (int i=0;i<4;++i) nav[i]=button(root,names[i],12+i*116,424,108,44,navigate,reinterpret_cast<void*>(uintptr_t(i)));
  render();
}
}

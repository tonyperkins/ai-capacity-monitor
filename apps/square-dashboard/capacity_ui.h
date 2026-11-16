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
// The bundled Montserrat fonts cover ASCII punctuation, but not typographic dashes.
inline std::string display_text(std::string text) {
  for (const auto* dash : {"\u2014", "\u2013", "\u2011"}) {
    size_t at=0;
    while ((at=text.find(dash,at))!=std::string::npos) { text.replace(at,std::string(dash).size(),"-"); ++at; }
  }
  return text;
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
  if (time_left >= 0) { label(modal,"Time until reset",16,349,448,&lv_font_montserrat_14,MUTED); bar(modal,16,373,448,8,time_left,0xb7a3ff); }
  std::string age = m.collected && now > m.collected ? "Reading collected " + capacity_model::duration(now-m.collected) + " ago" : "Waiting for the clock to sync";
  label(modal,age,16,398,448,&lv_font_montserrat_14,MUTED);
  label(modal,m.attention()?"Check the provider in your browser for details.":"Provider readings are collected by the browser extension.",16,439,448,&lv_font_montserrat_14,MUTED);
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
  help=label(body,"Refresh checks the local bridge. Your browser extension collects provider readings.",0,420,448,&lv_font_montserrat_14,MUTED);
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
inline void render() {
  std::vector<const Metric*> selected;
  if (view == 0 || view == 1) {
    selected = capacity_model::select(snapshot,"quota",view==0);
    if (view==0 && selected.size()>3) selected.resize(3);
  } else if (view == 2) selected = capacity_model::select(snapshot,"credit");
  std::string key = std::to_string(view)+":"+std::to_string(have_data);
  for (const auto* m : selected) key += ":"+m->key;
  if (layout_key != key) {
    layout_key = key; rows.clear(); brightness_label = nullptr; rotation_label=nullptr;
    lv_obj_clean(body); lv_obj_scroll_to_y(body,0,LV_ANIM_OFF);
    if (view == 3) render_settings();
    else if (!have_data || selected.empty()) {
      label(body,!have_data?"Connecting to your data":view==2?"No balances to show":"No limits to show",0,72,448,&lv_font_montserrat_24);
      label(body,!have_data?"Waiting for the local bridge snapshot.":"Enable providers in the browser extension to add readings here.",0,123,448,&lv_font_montserrat_18,MUTED);
    } else {
      label(body,view==0?"Limits to watch":view==1?"All limits":"Your balances",0,0,448,&lv_font_montserrat_20,MUTED);
      if (view==0) label(body,"Lowest capacity / attention",218,5,230,&lv_font_montserrat_14,MUTED);
      for (size_t i=0;i<selected.size();++i) {
        const bool credit = view == 2;
        const int x=credit?int(i%2)*230:0, y=credit?36+int(i/2)*154:34+int(i)*98;
        const int width=credit?(selected.size()==1?448:218):448, height=credit?142:90;
        auto* card=lv_obj_create(body); box(card,x,y,width,height);
        lv_obj_add_flag(card,LV_OBJ_FLAG_CLICKABLE);
        lv_obj_add_event_cb(card,row_clicked,LV_EVENT_CLICKED,reinterpret_cast<void*>(i));
        Row row; row.key=selected[i]->key;
        row.name=label(card,"",12,10,width-24,credit?&lv_font_montserrat_16:&lv_font_montserrat_18);
        row.value=label(card,"",credit?12:316,credit?40:29,credit?width-24:120,credit?&lv_font_montserrat_32:&lv_font_montserrat_24,CYAN);
        if (!credit) lv_obj_set_style_text_align(row.value,LV_TEXT_ALIGN_RIGHT,0);
        row.note=label(card,"",12,credit?83:34,credit?width-24:288,&lv_font_montserrat_14,MUTED);
        row.bar=credit?nullptr:bar(card,12,58,width-24,5,0,CYAN);
        row.reset=label(card,"",12,credit?112:69,credit?width-24:width-132,&lv_font_montserrat_14,MUTED);
        row.time_bar=credit?nullptr:bar(card,width-100,76,88,4,0,0xb7a3ff);
        // Fixed line heights make ellipsis effective instead of allowing labels to wrap.
        for(auto* text : {row.name,row.value,row.note,row.reset})
          lv_obj_set_height(text,lv_obj_get_style_text_font(text,LV_PART_MAIN)->line_height);
        rows.push_back(row);
      }
    }
    for (int i=0;i<4;++i) {
      lv_obj_set_style_bg_color(nav[i],color(i==view?CYAN:PANEL),0);
      auto* l=lv_obj_get_child(nav[i],0);lv_obj_set_style_text_color(l,color(i==view?BG:MUTED),0);
    }
  }
  update_rows(); update_status();
}
inline void update_status() {
  if (!status) return;
  const auto now = ::time(nullptr);
  std::string text;
  uint32_t shade = MUTED;
  if (busy) text="Checking the bridge...";
  else if (!have_data) text=online?"Connected / waiting for readings":"Waiting for the local bridge";
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
      set_text(lv_obj_get_child(issues_button,0),std::to_string(snapshot.issue_count)+" issues");
    } else lv_obj_add_flag(issues_button,LV_OBJ_FLAG_HIDDEN);
  }
  if (view!=3) update_rows();
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
  const char* names[]={"Overview","Limits","Balances","Settings"};
  for (int i=0;i<4;++i) nav[i]=button(root,names[i],12+i*116,424,108,44,navigate,reinterpret_cast<void*>(uintptr_t(i)));
  render();
}
}

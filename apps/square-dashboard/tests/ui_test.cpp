#include "capacity_ui.h"
#include <cassert>
#include <fstream>
#include <iostream>
#include <filesystem>
static uint16_t pixels[480*480];
static void flush(lv_display_t* d,const lv_area_t* a,uint8_t* data) {
  auto* in=reinterpret_cast<uint16_t*>(data);
  for(int y=a->y1;y<=a->y2;++y) for(int x=a->x1;x<=a->x2;++x) pixels[y*480+x]=*in++;
  lv_display_flush_ready(d);
}
static void shot(lv_display_t* display,const char* name) {
  lv_obj_update_layout(lv_screen_active());lv_tick_inc(20);lv_timer_handler();lv_refr_now(display);
  std::ofstream out(std::string(name)+".ppm",std::ios::binary);out<<"P6\n480 480\n255\n";
  for(auto p:pixels) { char c[]={char(((p>>11)&31)*255/31),char(((p>>5)&63)*255/63),char((p&31)*255/31)};out.write(c,3); }
}
int main() {
  using namespace capacity_model;
  assert(epoch("2026-11-14T20:00:00Z")==1794686400);
  assert(epoch("2026-02-30T20:00:00Z")==0);
  assert(epoch("2026-11-14T20:00:00+02:00")==0);
  JsonDocument doc;
  doc["version"]="1";doc["collectedAt"]="2026-11-14T20:00:00Z";
  auto array=doc["metrics"].to<JsonArray>();
  auto add=[&](const char* key,const char* provider,const char* label,const char* kind,const char* unit,double value) {
    auto m=array.add<JsonObject>();m["key"]=key;m["provider"]=provider;m["label"]=label;m["kind"]=kind;m["unit"]=unit;m["value"]=value;m["status"]="verified";
    if(std::string(kind)=="quota") {m["resetAt"]="2026-11-15T22:00:00Z";m["resetWindowMs"]=604800000;}
    return m;
  };
  add("balance","Claude.ai","Usage credit balance","credit","usd",335);
  add("claude-session","Claude Pro","Current session","quota","percent",24);
  add("chatgpt-weekly","ChatGPT","Weekly limit","quota","percent",92);
  add("grok-weekly","Grok / Cursor","Shared weekly limit","quota","percent",66);
  add("claude-weekly","Claude Pro","Weekly \u2014 all models","quota","percent",89);
  add("chatgpt-session","ChatGPT","5-hour limit","quota","percent",100);
  auto unlimited=add("monthly-cap","Claude usage","Monthly spending cap","quota","percent",100);unlimited["availability"]="unlimited";
  add("gemini-session","Gemini Pro","Current usage","quota","percent",72);
  add("gemini-weekly","Gemini Pro","Weekly limit","quota","percent",85);
  Snapshot parsed;
  assert(parse(doc.as<JsonObject>(),parsed));assert(parsed.metrics.size()==9);
  assert(parsed.metrics[0].display=="$3.35");
  auto rank=select(parsed,"quota",true);assert(rank[0]->key=="claude-session");assert(rank.back()->unlimited);
  assert(reset_percent(*rank[0],epoch("2026-11-15T22:00:00Z"))==0);
  assert(reset_percent(*rank[0],0)==-1);
  auto timed=*rank[0];timed.window_ms=5*60*60*1000;
  assert(reset_percent(timed,timed.reset-9000)==50);
  assert(reset_percent(timed,timed.reset-36000)==100);
  assert(reset_percent(timed,timed.reset+60)==0);
  assert(reset_text(timed,timed.reset+60).find("awaiting collection")!=std::string::npos);
  assert(reset_deadline(timed).find("Reset time: ")==0);
  timed.reset=0;assert(reset_percent(timed,1794686400)==-1);assert(reset_deadline(timed).empty());
  auto old=parsed;doc["metrics"][1]["value"]=101;
  assert(!parse(doc.as<JsonObject>(),parsed));assert(parsed.metrics.size()==old.metrics.size());
  assert(parsed.metrics[1].value==24);doc["metrics"][1]["value"]=24;
  doc["metrics"][0]["value"]=-125;assert(parse(doc.as<JsonObject>(),old));assert(old.metrics[0].display=="-$1.25");doc["metrics"][0]["value"]=335;
  doc["metrics"][2]["key"]="claude-session";assert(!parse(doc.as<JsonObject>(),old));doc["metrics"][2]["key"]="chatgpt-weekly";
  lv_init();auto* display=lv_display_create(480,480);
  static uint16_t draw[480*480];lv_display_set_color_format(display,LV_COLOR_FORMAT_RGB565);
  lv_display_set_buffers(display,draw,nullptr,sizeof(draw),LV_DISPLAY_RENDER_MODE_FULL);lv_display_set_flush_cb(display,flush);
  int refreshes=0;float brightness=0;
  capacity_ui::begin([&]{++refreshes;},[&](float v){brightness=v;});
  assert(capacity_ui::accept_snapshot(doc.as<JsonObject>()));assert(capacity_ui::rows.size()==3);
  shot(display,"overview");
  doc["metrics"][1].remove("resetAt");doc["metrics"][1].remove("resetWindowMs");
  assert(capacity_ui::accept_snapshot(doc.as<JsonObject>()));
  assert(lv_obj_has_flag(capacity_ui::rows[0].time_bar,LV_OBJ_FLAG_HIDDEN));
  doc["metrics"][1]["resetAt"]="2026-11-15T22:00:00Z";doc["metrics"][1]["resetWindowMs"]=604800000;
  assert(capacity_ui::accept_snapshot(doc.as<JsonObject>()));
  assert(!lv_obj_has_flag(capacity_ui::rows[0].time_bar,LV_OBJ_FLAG_HIDDEN));
  lv_obj_send_event(lv_obj_get_parent(capacity_ui::rows[0].name),LV_EVENT_CLICKED,nullptr);
  assert(capacity_ui::modal!=nullptr);assert(capacity_ui::detail_key=="claude-session");shot(display,"detail");capacity_ui::close_detail(nullptr);
  lv_obj_send_event(capacity_ui::nav[1],LV_EVENT_CLICKED,nullptr);assert(capacity_ui::rows.size()==8);
  shot(display,"limits");assert(lv_obj_get_scroll_bottom(capacity_ui::body)>0);
  assert(std::string(lv_label_get_text(capacity_ui::rows[3].name))=="Claude Pro / Weekly - all models");
  auto& unlimited_row=capacity_ui::rows[5];
  lv_point_t text_size;
  lv_text_get_size(&text_size,"Unlimited",&lv_font_montserrat_20,0,0,1000,LV_TEXT_FLAG_NONE);
  assert(text_size.x<=lv_obj_get_width(unlimited_row.value));
  assert(lv_obj_get_height(unlimited_row.value)==lv_font_montserrat_20.line_height);
  assert(lv_obj_get_y(unlimited_row.value)+lv_obj_get_height(unlimited_row.value)<lv_obj_get_y(unlimited_row.bar));
  lv_obj_scroll_to_view(lv_obj_get_parent(unlimited_row.name),LV_ANIM_OFF);shot(display,"limits-unlimited");
  lv_obj_send_event(capacity_ui::nav[2],LV_EVENT_CLICKED,nullptr);assert(capacity_ui::rows.size()==1);shot(display,"balances");
  lv_obj_send_event(capacity_ui::nav[3],LV_EVENT_CLICKED,nullptr);shot(display,"settings");
  for(uint32_t i=0;i<lv_obj_get_child_count(capacity_ui::body);++i) {
    auto* child=lv_obj_get_child(capacity_ui::body,i);
    if(lv_obj_check_type(child,&lv_slider_class)) {lv_slider_set_value(child,75,LV_ANIM_OFF);lv_obj_send_event(child,LV_EVENT_VALUE_CHANGED,nullptr);}
  }
  assert(brightness==.75f);
  int orientation=-1,rotation_saves=0;
  capacity_ui::configure_rotation(0,[&](int degrees,bool save){orientation=degrees;if(save)++rotation_saves;});
  lv_obj_t* rotate_button=nullptr;
  for(uint32_t i=0;i<lv_obj_get_child_count(capacity_ui::body);++i) {
    auto* child=lv_obj_get_child(capacity_ui::body,i);
    if(lv_obj_check_type(child,&lv_button_class) && lv_obj_get_child_count(child)
       && std::string(lv_label_get_text(lv_obj_get_child(child,0)))=="Rotate 90 deg clockwise") rotate_button=child;
  }
  assert(rotate_button);
  for(int angle: {90,180,270,0}) {
    lv_obj_send_event(rotate_button,LV_EVENT_CLICKED,nullptr);
    assert(orientation==angle && capacity_ui::rotation_degrees==angle);
    assert(std::string(lv_label_get_text(capacity_ui::rotation_label))==std::to_string(angle)+" deg");
  }
  assert(rotation_saves==4);
  capacity_ui::apply_rotation(270,false);
  lv_obj_send_event(capacity_ui::refresh_button,LV_EVENT_CLICKED,nullptr);assert(refreshes==1);
  capacity_ui::set_busy(true);assert(lv_obj_has_state(capacity_ui::refresh_button,LV_STATE_DISABLED));
  capacity_ui::connection_failed();assert(!capacity_ui::online);assert(capacity_ui::snapshot.metrics.size()==9);
  lv_obj_send_event(capacity_ui::nav[0],LV_EVENT_CLICKED,nullptr);
  assert(std::string(lv_label_get_text(capacity_ui::status)).find("Offline")!=std::string::npos);
  doc["diagnostics"][0]["key"]="chatgpt-weekly";doc["diagnostics"][0]["state"]="unauthenticated";
  assert(capacity_ui::accept_snapshot(doc.as<JsonObject>()));assert(capacity_ui::rows[0].key=="chatgpt-weekly");
  assert(std::string(lv_label_get_text(capacity_ui::rows[0].note))=="Sign in required / prior value");shot(display,"attention");
  assert(!lv_obj_has_flag(capacity_ui::issues_button,LV_OBJ_FLAG_HIDDEN));
  lv_obj_send_event(capacity_ui::issues_button,LV_EVENT_CLICKED,nullptr);assert(capacity_ui::modal);shot(display,"issues");capacity_ui::close_detail(nullptr);
  // Recover a shifted and scaled, mirrored controller range from raw targets.
  std::array<capacity_touch::Point,5> raw;
  for(size_t i=0;i<raw.size();++i) {
    const auto target=capacity_touch::targets[i];
    raw[i]={150+1.5*(480-target.x),30+2*(480-target.y)};
  }
  auto calibrated=capacity_touch::solve(raw);
  assert(calibrated.valid && calibrated.mirror_x && calibrated.mirror_y && !calibrated.swap_xy);
  assert(calibrated.xmin==150 && calibrated.xmax==870);
  assert(calibrated.ymin==30 && calibrated.ymax==990);
  assert(capacity_touch::Calibration::restore(calibrated.saved()).valid);
  for(size_t i=0;i<raw.size();++i) {
    auto point=calibrated.map(raw[i]);
    assert(std::hypot(point.x-capacity_touch::targets[i].x,point.y-capacity_touch::targets[i].y)<2);
  }
  auto bad=raw;bad[4].x+=100;assert(!capacity_touch::solve(bad).valid);
  auto corrupt=calibrated.saved();corrupt[1]=corrupt[0];assert(!capacity_touch::Calibration::restore(corrupt).valid);
  std::array<capacity_touch::Point,5> swapped;
  for(size_t i=0;i<swapped.size();++i) {
    const auto target=capacity_touch::targets[i];
    swapped[i]={60+1.4*(480-target.y),20+2*target.x};
  }
  auto sw=capacity_touch::solve(swapped);assert(sw.valid && sw.swap_xy && !sw.mirror_x && sw.mirror_y);
  int prepared=0,saved=0,applied=0;
  auto apply=[&](const capacity_touch::Calibration& c,bool save){assert(c.valid);++applied;if(save)++saved;};
  capacity_ui::configure_touch_calibration({0,480,0,480,1,1,0,0},[&]{++prepared;},apply);
  assert(prepared==1 && capacity_ui::calibration_stage==0);assert(orientation==0 && rotation_saves==4);shot(display,"calibration");
  for(size_t i=0;i<raw.size();++i) {
    capacity_ui::calibration_touch(int(raw[i].x),int(raw[i].y));
    capacity_ui::calibration_release();
    if(i==1)shot(display,"calibration_top");
  }
  assert(applied==1 && saved==0 && capacity_ui::calibration_stage==5);
  shot(display,"calibration_check");
  lv_obj_send_event(lv_obj_get_child(capacity_ui::modal,lv_obj_get_child_count(capacity_ui::modal)-1),LV_EVENT_CLICKED,nullptr);
  assert(saved==1 && capacity_ui::calibration_stage==-1 && capacity_ui::modal==nullptr);
  assert(orientation==270 && capacity_ui::rotation_degrees==270 && rotation_saves==4);
  capacity_ui::configure_touch_calibration(calibrated.saved(),[&]{++prepared;},apply);
  assert(prepared==1 && capacity_ui::modal==nullptr);
  std::cout<<"PASS: model validation, priorities, detail/navigation, scrolling, brightness, refresh and offline retention\n";
}

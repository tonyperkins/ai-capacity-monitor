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
  // Readings shaped like the collector's output. Resets are relative to the
  // real clock so countdowns and time-left dots render as they would live.
  const time_t base=::time(nullptr);
  auto iso=[&](long offset) {
    time_t t=base+offset; tm utc={}; gmtime_r(&t,&utc);
    char out[32]; strftime(out,sizeof(out),"%Y-%m-%dT%H:%M:%SZ",&utc); return std::string(out);
  };
  const long H=3600, D=86400;
  JsonDocument doc;
  doc["version"]="1";doc["collectedAt"]=iso(-60);
  auto array=doc["metrics"].to<JsonArray>();
  auto add=[&](const char* key,const char* id,const char* provider,const char* label,double value,long window_hours,long reset_in) {
    auto m=array.add<JsonObject>();m["key"]=key;m["providerId"]=id;m["provider"]=provider;m["label"]=label;
    m["kind"]="quota";m["unit"]="percent";m["value"]=value;m["status"]="verified";m["readState"]="validated";
    if(window_hours)m["resetWindowMs"]=window_hours*3600000LL;
    if(reset_in)m["resetAt"]=iso(reset_in);
    return m;
  };
  add("claude/session","claude","Claude","Current session",36,5,3*H);
  add("claude/week","claude","Claude","Current week (all models)",84,168,5*D+14*H);
  add("claude/fable","claude","Claude","Current week (Fable)",82,168,5*D+14*H)["parent"]="claude/week";
  add("chatgpt/5h","chatgpt","ChatGPT","5-hour limit",100,5,5*H);
  add("chatgpt/weekly","chatgpt","ChatGPT","Weekly limit",66,168,3*D+12*H);
  add("gemini/models-weekly","gemini","Gemini","Gemini Models · Weekly Limit",91,168,5*D+15*H)["group"]="Gemini Models";
  add("gemini/argon","gemini","Gemini","Gemini 4 Argon · Weekly Limit",45,168,5*D+15*H)["group"]="Gemini 4 Argon";
  add("gemini/5h","gemini","Gemini","Gemini Models · Five Hour Limit",100,5,0);
  add("grok/weekly","grok","Grok","Weekly limit",50,168,3*D+1*H);
  add("devin/daily","devin","Devin","Daily quota",8,24,6*H);
  add("devin/weekly","devin","Devin","Weekly quota",97,168,6*D);
  add("claude/cap","claude","Claude","Monthly spending cap",100,744,0)["availability"]="unlimited";
  { auto m=array.add<JsonObject>();m["key"]="balance";m["provider"]="Claude.ai";m["label"]="Usage credit balance";m["kind"]="credit";m["unit"]="usd";m["value"]=335;m["status"]="verified"; }
  // A kind of reading this firmware has never heard of must not blank the display.
  { auto m=array.add<JsonObject>();m["key"]="claude/resets";m["provider"]="Claude";m["label"]="Limit resets";m["kind"]="allowance";m["unit"]="count";m["value"]=2;m["status"]="verified"; }
  Snapshot parsed;
  assert(parse(doc.as<JsonObject>(),parsed));assert(parsed.metrics.size()==13);assert(parsed.skipped==1);
  assert(parsed.issues.size()==1 && parsed.issues[0].find("does not understand")!=std::string::npos && parsed.issue_count==1);
  assert(parsed.metrics[2].parent=="claude/week" && parsed.metrics[6].group=="Gemini 4 Argon" && parsed.metrics[0].provider_id=="claude");
  assert(parsed.metrics[12].display=="$3.35");
  // A bad value or a repeated key drops that one reading and keeps the rest.
  doc["metrics"][1]["value"]=101;
  assert(parse(doc.as<JsonObject>(),parsed));assert(parsed.metrics.size()==12 && parsed.skipped==2);
  doc["metrics"][1]["value"]=84;doc["metrics"][4]["key"]="chatgpt/5h";
  assert(parse(doc.as<JsonObject>(),parsed));assert(parsed.metrics.size()==12 && parsed.skipped==2);
  doc["metrics"][4]["key"]="chatgpt/weekly";
  doc["metrics"][12]["value"]=-125;assert(parse(doc.as<JsonObject>(),parsed));assert(parsed.metrics[12].display=="-$1.25");doc["metrics"][12]["value"]=335;
  // A payload with nothing usable, or a bad envelope, leaves the last snapshot alone.
  { JsonDocument junk;junk["version"]="1";junk["collectedAt"]=iso(0);auto m=junk["metrics"].to<JsonArray>().add<JsonObject>();m["key"]="x";m["provider"]="X";m["label"]="x";m["kind"]="mystery";m["unit"]="?";m["value"]=1;
    assert(!parse(junk.as<JsonObject>(),parsed));assert(parsed.metrics.size()==13);
    junk["version"]="2";assert(!parse(junk.as<JsonObject>(),parsed)); }
  assert(parse(doc.as<JsonObject>(),parsed));
  // Provider summaries: first short-window limit, first long-window limit,
  // and the remaining long-window limits as extras.
  const auto list=providers(parsed);
  assert(list.size()==5);
  assert(list[0].id=="claude" && list[0].name=="Claude" && list[0].quick->key=="claude/session" && list[0].main->key=="claude/week");
  assert(list[0].extras.size()==1 && list[0].extras[0]->key=="claude/fable" && short_name(*list[0].extras[0])=="Fable");
  assert(list[1].quick->key=="chatgpt/5h" && list[1].main->key=="chatgpt/weekly" && list[1].extras.empty());
  assert(list[2].quick->key=="gemini/5h" && list[2].main->key=="gemini/models-weekly");
  assert(list[2].extras.size()==1 && list[2].extras[0]->key=="gemini/argon" && short_name(*list[2].extras[0])=="Argon");
  assert(list[3].quick==nullptr && list[3].main->key=="grok/weekly");
  assert(list[4].quick->key=="devin/daily" && list[4].main->key=="devin/weekly");
  assert(window_name(5*3600000ULL)=="5h" && window_name(24*3600000ULL)=="day" && window_name(168*3600000ULL)=="7d" && window_name(0).empty());
  // A provider whose only long-window limit is scoped still gets a main limit.
  { Snapshot scoped=parsed; scoped.metrics.erase(scoped.metrics.begin()+1);
    const auto again=providers(scoped); assert(again[0].main->key=="claude/fable" && again[0].extras.empty()); }
  Metric timed;timed.kind="quota";timed.state="validated";timed.reset=epoch("2026-11-15T22:00:00Z");timed.window_ms=604800000;
  assert(reset_percent(timed,timed.reset)==0);
  assert(reset_percent(timed,0)==-1);
  timed.window_ms=5*60*60*1000;
  assert(reset_percent(timed,timed.reset-9000)==50);
  assert(reset_percent(timed,timed.reset-36000)==100);
  assert(reset_percent(timed,timed.reset+60)==0);
  assert(reset_text(timed,timed.reset+60).find("awaiting collection")!=std::string::npos);
  assert(reset_deadline(timed).find("Reset time: ")==0);
  timed.reset=0;assert(reset_percent(timed,1794686400)==-1);assert(reset_deadline(timed).empty());
  assert(capacity_ui::display_text("A · B — C é 72°")=="A / B - C ? 72°");
  lv_init();auto* display=lv_display_create(480,480);
  static uint16_t draw[480*480];lv_display_set_color_format(display,LV_COLOR_FORMAT_RGB565);
  lv_display_set_buffers(display,draw,nullptr,sizeof(draw),LV_DISPLAY_RENDER_MODE_FULL);lv_display_set_flush_cb(display,flush);
  int refreshes=0;float brightness=0;
  capacity_ui::begin([&]{++refreshes;},[&](float v){brightness=v;});
  shot(display,"connecting");
  // Home: one row per provider, all visible without scrolling.
  assert(capacity_ui::accept_snapshot(doc.as<JsonObject>()));
  assert(capacity_ui::view==capacity_ui::HOME && capacity_ui::rows.empty());
  assert(capacity_ui::tap_ids==(std::vector<std::string>{"claude","chatgpt","gemini","grok","devin"}));
  assert(lv_obj_get_child_count(capacity_ui::body)==5);
  lv_obj_update_layout(capacity_ui::body);assert(lv_obj_get_scroll_bottom(capacity_ui::body)<=0);
  shot(display,"home");
  // Grok has no short window, so its row has fewer children than Claude's.
  assert(lv_obj_get_child_count(lv_obj_get_child(capacity_ui::body,3))<lv_obj_get_child_count(lv_obj_get_child(capacity_ui::body,0)));
  // A row opens every reading of that provider.
  lv_obj_send_event(lv_obj_get_child(capacity_ui::body,2),LV_EVENT_CLICKED,nullptr);
  assert(capacity_ui::modal && capacity_ui::detail_provider=="gemini" && capacity_ui::detail_key.empty());shot(display,"provider");
  assert(capacity_ui::accept_snapshot(doc.as<JsonObject>()));assert(capacity_ui::modal && capacity_ui::detail_provider=="gemini");
  capacity_ui::close_detail(nullptr);assert(capacity_ui::detail_provider.empty());
  // An unchanged snapshot does not redraw the face; a changed value does.
  auto* first_before=lv_obj_get_child(capacity_ui::body,0);
  const auto key_before=capacity_ui::layout_key;
  assert(capacity_ui::accept_snapshot(doc.as<JsonObject>()));
  if(capacity_ui::layout_key==key_before) assert(lv_obj_get_child(capacity_ui::body,0)==first_before);
  doc["metrics"][8]["value"]=40;assert(capacity_ui::accept_snapshot(doc.as<JsonObject>()));
  assert(capacity_ui::layout_key!=key_before);
  doc["metrics"][8]["value"]=50;assert(capacity_ui::accept_snapshot(doc.as<JsonObject>()));
  // Limits: every reading, quotas first, then balances.
  lv_obj_send_event(capacity_ui::nav[capacity_ui::LIMITS],LV_EVENT_CLICKED,nullptr);
  assert(capacity_ui::rows.size()==13);shot(display,"limits");assert(lv_obj_get_scroll_bottom(capacity_ui::body)>0);
  assert(std::string(lv_label_get_text(capacity_ui::rows[2].name))=="Claude / Current week (Fable)");
  assert(std::string(lv_label_get_text(capacity_ui::rows[6].name))=="Gemini / Gemini 4 Argon / Weekly Limit");
  assert(!lv_obj_has_flag(capacity_ui::rows[0].time_bar,LV_OBJ_FLAG_HIDDEN));
  assert(lv_obj_has_flag(capacity_ui::rows[7].time_bar,LV_OBJ_FLAG_HIDDEN));
  assert(capacity_ui::rows[12].key=="balance" && capacity_ui::rows[12].bar==nullptr);
  assert(std::string(lv_label_get_text(capacity_ui::rows[12].value))=="$3.35");
  lv_obj_send_event(lv_obj_get_parent(capacity_ui::rows[2].name),LV_EVENT_CLICKED,nullptr);
  assert(capacity_ui::modal!=nullptr);assert(capacity_ui::detail_key=="claude/fable");shot(display,"detail-scoped");capacity_ui::close_detail(nullptr);
  auto& unlimited_row=capacity_ui::rows[11];assert(unlimited_row.key=="claude/cap");
  lv_point_t text_size;
  lv_text_get_size(&text_size,"Unlimited",&lv_font_montserrat_20,0,0,1000,LV_TEXT_FLAG_NONE);
  assert(text_size.x<=lv_obj_get_width(unlimited_row.value));
  assert(lv_obj_get_height(unlimited_row.value)==lv_font_montserrat_20.line_height);
  assert(lv_obj_get_y(unlimited_row.value)+lv_obj_get_height(unlimited_row.value)<lv_obj_get_y(unlimited_row.bar));
  lv_obj_scroll_to_view(lv_obj_get_parent(unlimited_row.name),LV_ANIM_OFF);shot(display,"limits-end");
  lv_obj_send_event(capacity_ui::nav[capacity_ui::SETTINGS],LV_EVENT_CLICKED,nullptr);shot(display,"settings");
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
  capacity_ui::connection_failed();assert(!capacity_ui::online);assert(capacity_ui::snapshot.metrics.size()==13);
  lv_obj_send_event(capacity_ui::nav[capacity_ui::HOME],LV_EVENT_CLICKED,nullptr);
  assert(std::string(lv_label_get_text(capacity_ui::status)).find("Offline")!=std::string::npos);
  // A source the collector could not read keeps its last values, flagged.
  doc["diagnostics"][0]["key"]="chatgpt/weekly";doc["diagnostics"][0]["state"]="retained-prior";
  doc["issues"][0]="ChatGPT: could not read this time (timeout); showing the last values.";
  assert(capacity_ui::accept_snapshot(doc.as<JsonObject>()));shot(display,"attention");
  assert(!lv_obj_has_flag(capacity_ui::issues_button,LV_OBJ_FLAG_HIDDEN));
  assert(std::string(lv_label_get_text(lv_obj_get_child(capacity_ui::issues_button,0)))=="2 issues");
  lv_obj_send_event(capacity_ui::nav[capacity_ui::LIMITS],LV_EVENT_CLICKED,nullptr);
  assert(std::string(lv_label_get_text(capacity_ui::rows[4].note))=="Previous reading / prior value");
  lv_obj_send_event(capacity_ui::issues_button,LV_EVENT_CLICKED,nullptr);assert(capacity_ui::modal);shot(display,"issues");capacity_ui::close_detail(nullptr);
  // Fewer providers get taller rows; more than five scroll.
  { JsonDocument few;few["version"]="1";few["collectedAt"]=iso(-60);auto items=few["metrics"].to<JsonArray>();
    auto one=[&](const std::string& id,double value) { auto m=items.add<JsonObject>();
      m["key"]=id+"/weekly";m["provider"]=id;m["label"]="Weekly limit";m["kind"]="quota";m["unit"]="percent";m["value"]=value;m["status"]="verified";m["readState"]="validated";m["resetWindowMs"]=604800000LL;m["resetAt"]=iso(2*D); };
    one("Solo",4);one("Duo",20);
    lv_obj_send_event(capacity_ui::nav[capacity_ui::HOME],LV_EVENT_CLICKED,nullptr);
    assert(capacity_ui::accept_snapshot(few.as<JsonObject>()));assert(capacity_ui::tap_ids.size()==2);shot(display,"home-two");
    assert(lv_obj_get_height(lv_obj_get_child(capacity_ui::body,0))>100);
    for(const char* id : {"C","D","E","F","G"}) one(id,60);
    assert(capacity_ui::accept_snapshot(few.as<JsonObject>()));assert(capacity_ui::tap_ids.size()==7);
    lv_obj_update_layout(capacity_ui::body);assert(lv_obj_get_scroll_bottom(capacity_ui::body)>0);
    assert(capacity_ui::accept_snapshot(doc.as<JsonObject>())); }
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
  std::cout<<"PASS: tolerant parsing, provider summaries, home/limits faces, provider and reading detail, settings, refresh, offline retention and calibration\n";
}

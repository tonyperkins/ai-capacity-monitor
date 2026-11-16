#pragma once
#include <algorithm>
#include <array>
#include <cmath>

namespace capacity_touch {
struct Point { double x=0, y=0; };
inline constexpr std::array<Point,5> targets={Point{40,240},Point{440,240},Point{240,40},Point{240,440},Point{240,240}};
struct Calibration {
  int xmin=0,xmax=480,ymin=0,ymax=480;
  bool mirror_x=true,mirror_y=true,swap_xy=false;
  bool valid=false;
  double error=0;
  std::array<int,8> saved() const {return {xmin,xmax,ymin,ymax,int(mirror_x),int(mirror_y),int(swap_xy),valid?1:0};}
  static Calibration restore(const std::array<int,8>& values) {
    Calibration c;
    c.xmin=values[0];c.xmax=values[1];c.ymin=values[2];c.ymax=values[3];
    c.mirror_x=values[4];c.mirror_y=values[5];c.swap_xy=values[6];
    c.valid=values[7]==1 && c.xmin>=0 && c.xmax<=4095 && c.xmax-c.xmin>=100
        && c.ymin>=0 && c.ymax<=4095 && c.ymax-c.ymin>=100
        && (values[4]==0||values[4]==1) && (values[5]==0||values[5]==1) && (values[6]==0||values[6]==1);
    return c;
  }
  Point map(Point raw) const {
    if(swap_xy)std::swap(raw.x,raw.y);
    const auto normalize=[](double value,int low,int high,bool mirror) {
      double t=std::clamp((value-low)/(high-low),0.0,1.0);
      if(mirror)t=1-t;
      return std::floor(std::floor(t*4095)*480/4096);
    };
    return {normalize(raw.x,xmin,xmax,mirror_x),normalize(raw.y,ymin,ymax,mirror_y)};
  }
};
inline Calibration solve(std::array<Point,5> raw) {
  Calibration c;
  for(auto p:raw)if(!std::isfinite(p.x)||!std::isfinite(p.y))return c;
  const double dx=raw[1].x-raw[0].x,dy=raw[1].y-raw[0].y;
  c.swap_xy=std::abs(dy)>std::abs(dx);
  if(c.swap_xy)for(auto& p:raw)std::swap(p.x,p.y);
  const double xspan=raw[1].x-raw[0].x, yspan=raw[3].y-raw[2].y;
  if(std::abs(xspan)<80 || std::abs(yspan)<80)return c;
  const double x0=raw[0].x-xspan*.1, x480=raw[1].x+xspan*.1;
  const double y0=raw[2].y-yspan*.1, y480=raw[3].y+yspan*.1;
  c.xmin=std::clamp(int(std::lround(std::min(x0,x480))),0,4095);
  c.xmax=std::clamp(int(std::lround(std::max(x0,x480))),0,4095);
  c.ymin=std::clamp(int(std::lround(std::min(y0,y480))),0,4095);
  c.ymax=std::clamp(int(std::lround(std::max(y0,y480))),0,4095);
  c.mirror_x=xspan<0;c.mirror_y=yspan<0;
  if(c.xmax-c.xmin<100||c.ymax-c.ymin<100)return c;
  for(size_t i=0;i<raw.size();++i) {
    // map() accepts the original, unswapped controller axes.
    auto original=raw[i];if(c.swap_xy)std::swap(original.x,original.y);
    const auto actual=c.map(original);
    c.error=std::max(c.error,std::hypot(actual.x-targets[i].x,actual.y-targets[i].y));
  }
  c.valid=c.error<=18;
  return c;
}
}

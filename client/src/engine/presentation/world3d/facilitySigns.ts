import { Group } from 'three/webgpu';
import { ModelKit } from './modelKit';

// Simple raised block lettering keeps the signs readable at the game's pixel scale.
const GLYPHS: Record<string, string[]> = {
  A:['01110','10001','10001','11111','10001','10001','10001'],
  B:['11110','10001','10001','11110','10001','10001','11110'],
  C:['01111','10000','10000','10000','10000','10000','01111'],
  D:['11110','10001','10001','10001','10001','10001','11110'],
  E:['11111','10000','10000','11110','10000','10000','11111'],
  F:['11111','10000','10000','11110','10000','10000','10000'],
  G:['01111','10000','10000','10111','10001','10001','01111'],
  I:['11111','00100','00100','00100','00100','00100','11111'],
  K:['10001','10010','10100','11000','10100','10010','10001'],
  L:['10000','10000','10000','10000','10000','10000','11111'],
  N:['10001','11001','10101','10011','10001','10001','10001'],
  O:['01110','10001','10001','10001','10001','10001','01110'],
  P:['11110','10001','10001','11110','10000','10000','10000'],
  R:['11110','10001','10001','11110','10100','10010','10001'],
  S:['01111','10000','10000','01110','00001','00001','11110'],
  T:['11111','00100','00100','00100','00100','00100','00100'],
  U:['10001','10001','10001','10001','10001','10001','01110'],
  W:['10001','10001','10001','10101','10101','10101','01010'],
  ' ':['00000','00000','00000','00000','00000','00000','00000'],
};

export const ALK_FACILITY_LABELS: Record<string,string> = {
  central:'ALK TRADING', station:'ALK TRADING', compost:'BIO PROCESSOR', food:'FOOD PROCESSOR',
  weapons:'WEAPONS DEPOT', furnace:'FURNACE', water:'WATER',
};

/** Add a physical nameplate and extruded lettering to a building façade. */
export function addFacilitySign(kit:ModelKit, parent:Group, label:string, width:number, y:number, front:number): void {
  const cells=label.length*6-1, pixel=Math.min(.066, (width-.20)/cells, .42/7);
  const textWidth=cells*pixel, signWidth=textWidth+.28, signHeight=7*pixel+.16;
  kit.part(parent,'box',0x263a42,[signWidth,signHeight,.10],[0,y,front+.35]);
  kit.part(parent,'box',0x89a6a5,[signWidth+.10,signHeight+.08,.04],[0,y,front+.29]);
  for(let charIndex=0;charIndex<label.length;charIndex++) {
    const rows=GLYPHS[label[charIndex]];
    if(!rows) throw new Error(`Missing facility sign glyph: ${label[charIndex]}`);
    for(let row=0;row<rows.length;row++) {
      let column=0;
      while(column<5) {
        if(rows[row][column]!=='1'){column++;continue;}
        const start=column;while(column<5&&rows[row][column]==='1')column++;
        const x=-textWidth/2+(charIndex*6+(start+column)/2)*pixel;
        const letterY=y+(3-row)*pixel;
        kit.part(parent,'box',0xc6e9dd,[(column-start)*pixel,pixel,.025],[x,letterY,front+.415]);
      }
    }
  }
}

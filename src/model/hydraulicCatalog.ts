import type { DeviceDefinition, DeviceKind, ParameterDefinition, PortDefinition } from './types';

const p=(key:string,label:string,unit:string,value:number,min:number,max:number,step=1):ParameterDefinition=>({key,label,unit,default:value,min,max,step});
const fluid=(id:string,side:PortDefinition['side'],offset=50):PortDefinition=>({id,label:id,type:'fluid',direction:'both',side,offset});
const pair=[fluid('IN','left'),fluid('OUT','right')];
const resistance=p('resistance','Hệ số tổn thất','bar/(L/min)',.01,.00001,1000,.001);
const threshold=(value:number,unit:string,max=1000000,min=0)=>[p('threshold','Ngưỡng tác động',unit,value,min,max,.1),p('hysteresis','Độ trễ hồi phục',unit,value===50?5:.1,0,max,.1),p('comparison','So sánh','',0,0,1)];
const def=(kind:DeviceKind,name:string,shortName:string,width:number,height:number,ports:PortDefinition[],description:string,parameters:ParameterDefinition[]=[]):DeviceDefinition=>({kind,name,shortName,category:'Thủy lực',size:{width,height},ports,description,parameters,symbol:shortName,color:'#137fbb'});

export const hydraulicCatalog:DeviceDefinition[]=[
  def('hydraulic_pump','Bơm nước dẫn động trục','Bơm',120,120,[...pair,{id:'shaft',label:'Trục',type:'shaft',direction:'in',side:'bottom',offset:50}], 'Trục được động cơ lai mới bơm nước từ IN sang OUT. Đặt lưu lượng tự do và áp suất khóa đầu đẩy; lưu lượng thực phụ thuộc mạng ống.',[p('flowRate','Lưu lượng tự do','L/min',60,0,1000000,.1),p('pressureBar','Áp suất khóa đầu đẩy','bar',3,.01,1000,.1)]),
  def('water_tank','Bồn nước / nguồn nước vô tận','Bồn nước',120,140,[fluid('IN','left',40/140*100),fluid('OUT','right',120/140*100)],'Nước vào IN, hút ra OUT. Bồn hữu hạn theo dõi mức nước; nguồn vô tận dùng cho biển hoặc môi trường tiếp nhận.',[p('capacityL','Dung tích','L',1000,.1,1000000000,.1),p('initialLevel','Mức nước ban đầu','%',50,0,100,.1),p('infinite','Nguồn vô tận','',0,0,1),p('pressureBar','Áp suất nguồn','bar',0,0,1000,.1)]),
  def('hydraulic_valve','Van thủy lực tùy chỉnh','Van',100,80,pair,'Chọn van khóa, van một chiều IN → OUT, van tiết lưu hoặc van an toàn. Van khóa tác động bằng cách nhấn khi mô phỏng.',[p('valveMode','Loại van','',0,0,3),p('opening','Độ mở','%',100,0,100,1),resistance,p('setPressure','Áp suất mở van','bar',3,0,1000,.1)]),
  def('hydraulic_solenoid','Van nước điện từ','Van điện từ',120,100,[fluid('IN','left',60),fluid('OUT','right',60),{id:'A1',label:'A1',type:'power',direction:'both',side:'top',offset:25},{id:'A2',label:'A2',type:'power',direction:'both',side:'top',offset:75}], 'Van thường đóng. Cấp điện khép kín A1–A2 để mở đường IN–OUT; mất điện van đóng.',[resistance,p('coilVoltage','Điện áp cuộn hút','V',24,1,1000)]),
  def('hydraulic_filter','Bộ lọc nước','Bộ lọc',100,80,pair,'Tạo tổn thất áp trên đường ống. Độ tắc 100% chặn dòng nước.',[resistance,p('clogging','Độ tắc','%',0,0,100)]),
  def('pipe_junction','Nút nối đường ống','Nút ống',12,12,[fluid('J','right')],'Nối các nhánh ống cùng một điểm. Độc lập với nút nối dây điện.'),
  def('pressure_sensor','Cảm biến áp suất đường ống','Cảm biến áp',80,100,[fluid('P','bottom')],'Đấu P vào đường ống để đo áp suất tương đối và tác động NO/NC/CO cùng tên theo ngưỡng; có thể đặt ngưỡng âm cho phía hút.',threshold(1,'bar',1000,-1)),
  def('flow_sensor','Cảm biến lưu lượng nước','Cảm biến lưu lượng',100,80,pair,'Lắp nối tiếp IN–OUT để đo độ lớn lưu lượng và điều khiển tiếp điểm cùng tên.',threshold(10,'L/min')),
  def('level_sensor','Cảm biến mức nước trong bồn','Cảm biến mức',80,80,[],'Chọn bồn liên kết trong Thuộc tính. Đo mức nước thực của bồn, điều khiển NO/NC/CO cùng tên.',threshold(50,'%',100)),
];
export const hydraulicSensorKinds=new Set<DeviceKind>(['pressure_sensor','flow_sensor','level_sensor']);
export const isHydraulicKind=(kind:DeviceKind)=>hydraulicCatalog.some(item=>item.kind===kind);

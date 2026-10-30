# Electrical Studio

Ứng dụng web tiếng Việt để vẽ sơ đồ điện theo từng đầu cực và quan sát trạng thái đóng/cắt, kích từ, chuyển động và đường dòng điện. Phiên bản hiện tại tập trung vào thao tác vẽ và logic mạch kín; chưa tính các đại lượng điện hay đặc tuyến của thiết bị. Sơ đồ và mô phỏng chạy trong trình duyệt, không cần backend.

## Chạy ứng dụng

### Bản Windows và cập nhật

Tải `Electrical-Studio-Setup-…-x64.exe` tại [GitHub Releases](https://github.com/Nguyendal21/electrical-studio/releases/latest), chạy bộ cài một lần rồi mở icon Electrical Studio trên desktop. Ứng dụng dùng được offline. Bản portable 0.1.0 cũ chưa có cập nhật tự động; cài bản mới một lần để chuyển sang cơ chế này. Dữ liệu desktop vẫn ở `%APPDATA%/Electrical Studio`, giữ cùng origin `app://electrical-studio` nên sơ đồ cũ được giữ lại.

Khi mở ứng dụng và mỗi 4 giờ, bản cài kiểm tra GitHub. Có phiên bản mới sẽ hỏi trước khi tải; tải xong hỏi trước khi cài và mở lại. Chọn **Để sau** không tự cài khi đóng ứng dụng. Không có mạng thì tiếp tục dùng bình thường. Bản portable tạo bởi `npm run package:portable` không tự cập nhật.

`npm run package:win` tạo bộ cài NSIS trong `release/`; `npm run test:desktop` kiểm tra ứng dụng đã đóng gói, font offline, xuất/nhập và dữ liệu qua hai lần mở. `npm run test:updater` kiểm tra các lựa chọn cập nhật, mất mạng và lỗi tải. [electron-updater](https://www.electron.build/v26/docs/auto-update/) tải bản cài và kiểm tra checksum từ metadata, không tải mã nguồn trực tiếp để chạy.

Workflow `.github/workflows/release.yml` chạy khi đẩy code lên `main` (hoặc Run workflow), kiểm tra model/giao diện/desktop, đóng gói và phát hành `.exe`, `.blockmap`, `latest.yml`. Chỉ bản build vượt qua các kiểm tra mới được phát hành. Phiên bản phát hành lấy major/minor từ `package.json`, patch cộng số lượt chạy workflow để tăng tự động. Giữ số major/minor tăng dần khi đổi nhánh phát hành. Người dùng được báo khi **bản phát hành đã sẵn sàng**, không phải ngay khi vừa push code. Workflow dùng token GitHub cấp trong CI, không nhúng token vào ứng dụng.

Sau khi đã có release, có thể chạy `npm run test:update-feed -- "đường dẫn tới bản cũ/Electrical Studio.exe"` để kiểm tra chính nguồn cập nhật GitHub: chấp nhận tải, xác minh SHA-512 rồi chọn **Để sau** ở bước cài. Kiểm tra dùng hồ sơ và cache riêng trong `tmp-references/`, chặn mọi lời gọi cài đặt; không thay phiên bản đang dùng trên máy.

```powershell
cd D:\Code\Electrical\electrical-studio
npm ci
npm run dev
```

Mở địa chỉ Vite hiển thị trong terminal, mặc định **http://127.0.0.1:5173**.

```powershell
npm run build       # Kiểm tra TypeScript và tạo dist/
npm run preview     # Xem bản build
```

Có thể phục vụ thư mục `dist/` bằng static hosting. Môi trường phát triển đã dùng Node.js 24 và npm 11.

## Đóng gói ứng dụng Windows

Trên Windows x64, chạy:

```powershell
npm ci
npm run package:win
```

File portable có thể gửi trực tiếp cho người khác nằm ở `release/Electrical-Studio-0.1.0-Windows-x64.exe`. Người nhận không cần cài Node.js; chỉ cần tải file và chạy. Windows có thể hiện cảnh báo SmartScreen vì ứng dụng chưa được ký số.

## Vẽ và thao tác

Hai thanh icon ở trên dành cho công cụ và nhóm phần tử điện. Mỗi nhóm chỉ hiện một ký hiệu đại diện. Nhấn nhóm để mở toàn bộ linh kiện ngay bên dưới, nhấn lại hoặc Escape để thu gọn; có thể nhấn linh kiện để thêm hoặc kéo vào bản vẽ. Phím trái/phải chuyển giữa các nhóm, phím xuống mở nhóm và chuyển focus vào linh kiện. Bản vẽ chiếm phần còn lại của cửa sổ; thư viện tìm kiếm, thuộc tính và nhật ký chỉ mở khi cần. Di chuột lên icon để xem tên thao tác. Giữ chuột phải để kéo cả tờ giấy; lăn chuột để phóng to/thu nhỏ quanh con trỏ. Chuột trái chọn và di chuyển phần tử; khoảng trống quanh ký hiệu không chặn dây phía dưới.

1. Chọn **Tạo mới** hoặc **Mạch mẫu**. Kéo icon phần tử vào bản vẽ; cũng có thể nhấn icon để thêm vào giữa vùng nhìn. Giữ chuột trái và kéo trên vùng trống để khoanh chọn nhiều phần tử nằm trong khung. Kéo một phần tử đã chọn để di chuyển cả nhóm, hoặc nhấn **Delete** để xóa nhóm; **Ctrl+Z** hoàn tác cả thao tác.
2. Kéo giữa hai đầu cực để nối dây, hoặc lần lượt nhấn hai đầu cực. Mỗi đường là một dây dẫn. Có thể nối nhiều dây vào cùng đầu cực và nối các đầu khác nhau của cùng một thiết bị.
3. Chọn dây rồi kéo ô vuông để chỉnh đoạn dây vuông góc. Kéo đầu cực thả lên dây có sẵn (hoặc nhấn đầu cực rồi nhấn dây) để tạo nhánh nối. Nhấn đúp dây hoặc thả nút nối từ thư viện lên dây để chèn nút. Kéo vòng nhỏ quanh nút để di chuyển; tâm nút vẫn dùng để nối dây. Đặt nút tại giao điểm sẽ nối các dây điện đi qua tâm; dây giao nhau không có nút vẫn cách điện. Đặt/di chuyển nút và tách dây được hoàn tác cùng một lần Ctrl+Z. Khi mở sơ đồ cũ, app nối lại những nút đã đặt đúng trên dây nhưng chưa có kết nối thực.
4. Nhấn đúp phần tử để mở thuộc tính. Có thể đặt tên, xoay, chỉnh tham số, kéo tên tới vị trí khác hoặc ẩn tên. Với động cơ ba pha, lệnh đấu sao/tam giác tạo các cầu nối thật có thể sửa hoặc xóa.
5. Nhấn **Chạy mô phỏng**. Lúc đang chạy, nhấn trực tiếp CB để đóng/cắt, rơle nhiệt để tác động/reset, diesel để khởi động/dừng. Giữ nút nhấn để tác động, thả để nhả. Khi không chạy, thao tác trên phần tử dùng để chọn và biên tập.
6. Động cơ, máy phát, cuộn hút, cuộn kích từ, tiếp điểm liên động và đèn tự hoạt động theo mạch. Chúng không có công tắc “cho phép hoạt động”. Muốn dừng động cơ phải ngắt điều kiện cấp điện hoặc điều khiển tương ứng.

Icon thư viện luôn biểu diễn trạng thái nghỉ. CB và diesel vừa đặt chưa đóng/chưa chạy; nút NO đang mở, nút NC đang đóng, rơle nhiệt chưa tác động. Các mạch mẫu đã đặt sẵn một số CB và diesel ở trạng thái làm việc để dễ quan sát.

Phím tắt: **Space** chạy/tạm dừng, **R** xoay, **Delete** xóa, **Ctrl+C / Ctrl+V** sao chép/dán nhóm, **Ctrl+D** nhân bản, **Ctrl+Z / Ctrl+Y** hoàn tác/làm lại, **/** mở tìm kiếm, **Escape** đóng bảng hoặc bỏ chọn. Khi phần tử thao tác được đang có focus, **Enter/Space** cũng dùng để tác động; nút nhấn nhả khi thả phím.

Sao chép nhóm giữ các dây nối nội bộ, thông số, góc xoay và vị trí nhãn. Nhóm mới nhận ID và tên mới; khi sao chép cả máy/cuộn kích từ hoặc cuộn hút/tiếp điểm, tên liên kết được đổi đồng bộ. Sao chép riêng tiếp điểm hoặc cuộn kích từ vẫn giữ tên để bổ sung vào khí cụ hiện có. Mỗi lần dán lệch 40 px và có thể hoàn tác trong một bước. Clipboard này dùng trong ứng dụng, không ghi đè clipboard văn bản của hệ điều hành.

Công tắc và tiếp điểm cùng tên cũng được đổi tên đồng bộ khi sao chép nhóm. Các nhãn mạng/N trong nhóm nhận tên mạng mới để không vô tình nối sang mạch gốc; sao chép riêng một nhãn giữ tên mạng. Ký hiệu PE giữ tên mạng bảo vệ.

Nút **#** trên thanh công cụ ẩn/hiện số và tên đầu cực; lựa chọn được nhớ sau khi tải lại. Khi ẩn, di chuột lên đầu cực vẫn xem được tên. Các đầu cực và điểm gấp dây tự động dùng lưới 10 px; khoảng cách các cực công suất ba pha là 40 px.

## Liên kết khí cụ và máy điện

Tên hiển thị đồng thời là tên liên kết. Ví dụ cuộn hút `K1` điều khiển mọi tiếp điểm `K1`; máy điện `M1` nhận kích từ từ các cuộn kích từ `M1`. Không phân biệt hoa/thường và khoảng trắng ở hai đầu tên. ID nội bộ vẫn riêng cho từng phần tử.

| Phần tử | Hành vi hiện có |
|---|---|
| Nguồn DC, AC một pha, AC ba pha | Đầu cực riêng `+/−`, `L/N`, `L1/L2/L3/N`. Dây được cấp điện tô xanh đến hết các tiếp điểm đóng, nút nối và thanh cái, kể cả chưa có tải. Chấm chạy chỉ hiện trên nhánh có dòng trong mạch kín; các nguồn độc lập không tự dùng chung đường về. |
| Động cơ KĐB và ĐB | Sáu đầu `U1/U2`, `V1/V2`, `W1/W2`; cần đấu đủ ba cuộn và cấp ba pha. Động cơ ĐB còn cần cuộn kích từ DC cùng tên có điện. |
| Động cơ DC | Phần ứng `+/−` và cuộn kích từ rời `F1/F2` cùng tên. Hỗ trợ kiểm tra cách đấu kích từ độc lập, song song, nối tiếp, hỗn hợp; hỗn hợp cần cả cuộn nối tiếp và cuộn song song. Có dòng phần ứng mà thiếu kích từ thì không quay. |
| Máy phát DC/AC | Cần đồng thời trục được một động cơ/diesel lai và cuộn kích từ cùng tên được cấp DC. Mất một điều kiện thì mất đầu ra. Chưa mô phỏng quá trình tự kích từ dư. |
| Cuộn hút và tiếp điểm rời | Cuộn `A1/A2` phải khép mạch. NO `13/14` đóng, NC `21/22` mở khi cuộn cùng tên có điện. CO nối chung `11` với NC `12` khi nghỉ, chuyển sang NO `14` khi tác động. Có thể dùng nhiều tiếp điểm cùng tên, đặt ở các vị trí độc lập. |
| Rơle thời gian | Chọn trễ đóng hoặc trễ nhả và thời gian trễ ở cuộn. Tiếp điểm thời gian NO/NC cùng tên theo thời gian trễ; tiếp điểm thường cùng tên theo cuộn ngay lập tức. |
| Rơle nhiệt | Ba phần tử nhiệt nằm trên đường công suất. Nhấn để mô phỏng tác động: NO/NC/CO rời cùng tên đổi trạng thái. Nhấn lại để reset. Bản thân ba đường công suất không bị ngắt; tiếp điểm phụ dùng để ngắt mạch cuộn hút. |
| CB 1P/3P và nút nhấn | CB đóng/cắt một hoặc ba cực. Nút NO/NC trở về trạng thái nghỉ sau khi thả. |
| Động cơ bước và driver | Driver cần nguồn DC kín; động cơ cần đủ hai cuộn qua bốn đầu `A+/A−/B+/B−`. Tần số xung bằng 0 cho trạng thái giữ, không quay. |
| EMY / ЭМУ | Khối chức năng máy điện khuếch đại từ trường ngang: cần trục lai và nguồn DC khép kín qua cuộn điều khiển `F1/F2` để có đầu ra `+/−`. |
| Đèn và trục cơ khí | Đèn sáng khi có dòng qua mạch kín. Đường tím nét đứt biểu diễn trục cơ; không thể nối trục vào đầu điện. |
| Công tắc, selector, dừng khẩn và hành trình | Cơ cấu không có chân điện; thêm NO/NC/CO rời cùng tên ở Thuộc tính. Selector hai vị trí chạy 0–1, ba vị trí chạy 0–1–−1; mỗi tiếp điểm chọn nấc tác động. Dừng khẩn giữ sau khi nhấn, nhấn lại để nhả. Hành trình tác động khi giữ chuột và nhả khi thả. |
| Biến áp 1 pha/3 pha | Sơ cấp và thứ cấp riêng; biến áp ba pha hiện dùng mô hình sao–sao với trung tính ở hai phía. Đầu ra chỉ sẵn sàng khi đầu vào có mạch AC kín và đủ pha. |
| Nguồn AC–DC và cầu chỉnh lưu 1 pha/3 pha | Có các đầu vào AC và đầu ra DC riêng. Cầu chỉnh lưu dùng mô hình khối chức năng; chưa tính đường dẫn diode trong từng bán kỳ, gợn sóng hay sụt áp. |
| Điện trở, biến trở, chiết áp, điện trở nhiều cấp | Có đúng hai hoặc ba đầu nối. Tham số điện trở, vị trí con chạy/cấp được lưu; chưa tính ảnh hưởng của trị số lên dòng và điện áp. |
| Diode, tụ điện, cuộn cảm | Diode định hướng dòng DC. Tụ cho phép đường AC và chặn DC ở trạng thái xác lập; chưa tính nạp/xả hay góc lệch pha. Cuộn cảm dùng nhánh dẫn ở mức trạng thái, chưa tính quá độ. |
| Cầu đấu, giắc, thanh cái | Cầu đấu nối hai đầu; giắc có ba cặp độc lập 1–2, 3–4, 5–6; bốn đầu thanh cái nối chung. |
| Nhãn mạng, sang trang, PE và N | Nhãn mạng và đầu nối sang trang cùng tên nối điện logic trong cùng dự án. PE cùng tên nối chung, N cùng tên nối chung; PE/N/nhãn mạng thuộc các nhóm riêng. Không tự tạo nguồn hoặc đường về nếu chưa nối nguồn thật. Hiện bản vẽ vẫn là một trang. |
| Động cơ và máy phát AC một pha | Động cơ có cuộn chính U1/U2, cuộn phụ Z1/Z2; cần nguồn AC và tụ ngoài nối tiếp cuộn phụ. Máy phát có L/N, cần lai cơ và kích từ cùng tên. |
| Van, phanh, ly hợp và còi | Cuộn A1/A2 hoặc còi 1/2 cần mạch cấp kín. Chỉ biểu diễn trạng thái phần điện; chưa mô phỏng lưu chất, lực phanh, truyền mômen hoặc phát âm thanh. |

Có 16 mạch mẫu: bốn cách kích từ động cơ DC; động cơ ba pha đấu sao và tam giác; Start/Stop tự giữ dùng cuộn hút và tiếp điểm rời; rơle thời gian; máy phát DC và AC có lai cơ/kích từ; truyền động EMY; động cơ bước có driver; biến áp–chỉnh lưu cấp động cơ DC; công tắc ba vị trí và dừng khẩn; động cơ một pha có tụ; nhãn mạng/cầu đấu cấp van và còi.

## Phạm vi mô phỏng và ký hiệu

Bộ giải hiện tại dùng điện thế tương đối nội bộ để xác định nhánh có dòng, mạch hở, nối tắt và trạng thái các phần tử. Màu xanh tĩnh biểu diễn nguồn đã tới dây qua đường dẫn kín của CB/tiếp điểm/thanh cái; các chấm chuyển động chỉ biểu diễn dòng khi có mạch tải khép kín. N/PE và cực tham chiếu không tự được coi là cực có điện áp; dây về vẫn có chấm khi có dòng. Các giá trị nội bộ không phải điện áp, dòng điện hoặc công suất đo được, và chuyển động không phải dạng sóng AC tức thời.

Biến áp và bộ biến đổi được giải ổn định trước các cuộn hút. Mạch Start/Stop tự giữ dùng nguồn hai pha qua biến áp cách ly và nhãn mạng hoạt động như nguồn AC trực tiếp. Khi mất nguồn hoặc nhấn Stop, cuộn nhả; cấp lại nguồn không tự đóng lại tiếp điểm tự giữ.

Các thông số định mức được lưu để tiếp tục phát triển. Hiện chưa có tính tổn hao, sụt áp thực, mômen, tăng tốc, dòng khởi động, dòng ngắn mạch hoặc phối hợp bảo vệ. CB, cầu chì và rơle nhiệt chưa tự tác động theo đặc tuyến quá dòng/quá tải. Phát hiện nối tắt sẽ báo lỗi và ngừng hiển thị dòng bình thường của sơ đồ.

Ký hiệu cuộn hút, tiếp điểm, CB, cầu chì, đèn và máy điện được đối chiếu với tài liệu thiết bị và sơ đồ điện, gồm [Eaton Wiring Manual — bảng ký hiệu điện](https://www.eaton.com/content/dam/eaton/markets/machinebuilding/eaton-wiring-manual-pu08703001z-en-en-us.pdf) và [ABB Emax — sơ đồ và ký hiệu khí cụ](https://library.e.abb.com/public/aaed961bc6719923c125780800653781/ITSCE-RH0288002.pdf). Đây chưa phải thư viện được chứng nhận tuân thủ đầy đủ IEC. EMY, diesel và driver bước dùng ký hiệu khối chức năng để thể hiện các đầu nối của mô hình.

## Lưu sơ đồ

Sơ đồ tự lưu vào `localStorage` của trình duyệt. Dùng **Lưu tệp** để xuất JSON và **Mở** để nhập lại. Tệp lưu thiết bị, tên liên kết, cách kích từ, góc xoay, vị trí/ẩn tên, đường dây, màu và điểm bẻ góc; không lưu tiến trình mô phỏng đang chạy.

Định dạng hiện tại là `version: 2`. Sơ đồ v2 cũ vẫn đọc được; các đầu `95/96` của rơle nhiệt và contactor liền khối được giữ để tương thích. Phiên bản 1 dùng đường dây gộp nên không tự chuyển đổi sang sơ đồ từng đầu cực; dữ liệu cũ dùng khóa lưu riêng. `localStorage` có thể mất khi xóa dữ liệu trình duyệt, vì vậy nên xuất tệp cho các sơ đồ cần giữ.

## Kiểm thử và mở rộng

```powershell
npm test
npx playwright install chromium
npm run test:e2e
```

Kiểm thử mô hình bao gồm mạch kín/hở, nguồn độc lập, kích từ và lai cơ, sao/tam giác, tự giữ, rơle thời gian, rơle nhiệt và CO, trạng thái thao tác, đường dây và nhập/xuất. Kiểm thử trình duyệt thực hiện các thao tác vẽ và mô phỏng; ảnh/trace lỗi được ghi trong `test-results/`.

Các phần chính của mã nguồn:

| Tệp | Vai trò |
|---|---|
| `src/App.tsx` | Biên tập sơ đồ, thao tác, lưu tệp và điều phối mô phỏng |
| `src/components/EquipmentNode.tsx`, `DeviceSymbol.tsx` | Ký hiệu SVG, đầu cực, thao tác và nhãn phần tử |
| `src/components/SchematicEdge.tsx` | Dây vuông góc, sửa đường đi, hiển thị dòng |
| `src/components/CircuitMonitor.tsx` | Trạng thái mạch và nhật ký tùy chọn |
| `src/model/catalog.ts`, `types.ts` | Loại phần tử, đầu cực, tham số và thao tác cho phép |
| `src/model/simulation.ts` | Kiểm tra kết nối và logic hoạt động |
| `src/model/geometry.ts` | Tọa độ đầu cực, góc xoay và định tuyến |
| `src/model/persistence.ts`, `examples.ts` | Định dạng JSON v2 và các mạch mẫu |
| `src/schematic.css` | Giao diện bản vẽ và các bảng công cụ |

Để thêm thiết bị, bổ sung `DeviceKind`, định nghĩa đầu cực trong `catalog.ts`, ký hiệu SVG, hành vi trong `simulation.ts` và kiểm thử điều kiện hoạt động. Các kiểu dữ liệu và bộ giải độc lập với giao diện để có thể bổ sung phần tính toán sau.

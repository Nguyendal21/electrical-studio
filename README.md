# Electrical Studio

Ứng dụng web tiếng Việt để vẽ sơ đồ điện theo từng đầu cực và quan sát trạng thái đóng/cắt, kích từ, chuyển động và đường dòng điện. Bộ mô phỏng chính xét logic mạch kín; lớp đo lường riêng hỗ trợ nguồn lý tưởng và mạch điện trở. Chưa tính đầy đủ đặc tuyến điện/cơ và quá độ của máy điện. Sơ đồ và mô phỏng chạy trong trình duyệt, không cần backend.

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

Bản cài nằm ở `release/Electrical-Studio-Setup-<phiên-bản>-x64.exe`. Gửi tệp này cho người khác; người nhận không cần Node.js, chạy tệp để cài và tạo icon desktop. Bản cài hỗ trợ cập nhật qua GitHub Releases. Nếu cần bản portable, chạy `npm run package:portable`; tệp `release/Electrical-Studio-<phiên-bản>-Windows-x64.exe` chạy trực tiếp nhưng không tự cập nhật. Windows có thể hiện cảnh báo SmartScreen vì ứng dụng chưa được ký số.

## Vẽ và thao tác

Hai thanh icon ở trên dành cho công cụ và nhóm phần tử điện. Mỗi nhóm chỉ hiện một ký hiệu đại diện. Nhấn nhóm để mở toàn bộ linh kiện ngay bên dưới, nhấn lại hoặc Escape để thu gọn; có thể nhấn linh kiện để thêm hoặc kéo vào bản vẽ. Phím trái/phải chuyển giữa các nhóm, phím xuống mở nhóm và chuyển focus vào linh kiện. Bản vẽ chiếm phần còn lại của cửa sổ; thư viện tìm kiếm, thuộc tính và nhật ký chỉ mở khi cần. Di chuột lên icon để xem tên thao tác. Giữ chuột phải để kéo cả tờ giấy; lăn chuột để phóng to/thu nhỏ quanh con trỏ. Chuột trái chọn và di chuyển phần tử; khoảng trống quanh ký hiệu không chặn dây phía dưới.

1. Chọn **Tạo mới** hoặc **Mạch mẫu**. Kéo icon phần tử vào bản vẽ; cũng có thể nhấn icon để thêm vào giữa vùng nhìn. Giữ chuột trái và kéo trên vùng trống để khoanh chọn nhiều phần tử nằm trong khung. Kéo một phần tử đã chọn để di chuyển cả nhóm, hoặc nhấn **Delete** để xóa nhóm; **Ctrl+Z** hoàn tác cả thao tác.
2. Kéo giữa hai đầu cực để nối dây, hoặc lần lượt nhấn hai đầu cực. Mỗi đường là một dây dẫn. Có thể nối nhiều dây vào cùng đầu cực và nối các đầu khác nhau của cùng một thiết bị.
3. Chọn dây rồi kéo ô vuông để chỉnh đoạn dây vuông góc. Kéo đầu cực thả lên dây có sẵn (hoặc nhấn đầu cực rồi nhấn dây) để tạo nhánh nối. Nhấn đúp dây hoặc thả nút nối từ thư viện lên dây để chèn nút. Kéo vòng nhỏ quanh nút để di chuyển; tâm nút vẫn dùng để nối dây. Đặt nút tại giao điểm sẽ nối các dây điện đi qua tâm; dây giao nhau không có nút vẫn cách điện. Đặt/di chuyển nút và tách dây được hoàn tác cùng một lần Ctrl+Z. Khi mở sơ đồ cũ, app nối lại những nút đã đặt đúng trên dây nhưng chưa có kết nối thực.
4. Nhấn đúp phần tử để mở thuộc tính. Có thể đặt tên, xoay, chỉnh tham số, kéo tên tới vị trí khác hoặc ẩn tên. Với động cơ ba pha, lệnh đấu sao/tam giác tạo các cầu nối thật có thể sửa hoặc xóa.
5. Nhấn **Chạy mô phỏng**. Lúc đang chạy, nhấn trực tiếp CB để đóng/cắt, rơle nhiệt để tác động/reset, diesel để khởi động/dừng. Giữ nút nhấn để tác động, thả để nhả. Khi không chạy, thao tác trên phần tử dùng để chọn và biên tập.
6. Động cơ, máy phát, cuộn hút, cuộn kích từ, tiếp điểm liên động và đèn tự hoạt động theo mạch. Chúng không có công tắc “cho phép hoạt động”. Muốn dừng động cơ phải ngắt điều kiện cấp điện hoặc điều khiển tương ứng.

Icon thư viện luôn biểu diễn trạng thái nghỉ. CB và diesel vừa đặt chưa đóng/chưa chạy; nút NO đang mở, nút NC đang đóng, rơle nhiệt chưa tác động. Các mạch mẫu đã đặt sẵn một số CB và diesel ở trạng thái làm việc để dễ quan sát.

Nhóm **Điều khiển** có **Nút nhấn liên động**: đặt tên, ví dụ `SB1`, rồi thêm tiếp điểm NO/NC/CO cùng tên trong Thuộc tính. Khi mô phỏng, giữ chuột trái hoặc Space/Enter trên nút để NO đóng, NC mở, CO chuyển nhánh; thả để trả về trạng thái nghỉ. Nút là cơ cấu điều khiển, không có đầu dây riêng. Các nút NO/NC thông thường chỉ đóng/cắt hai đầu dây của chính nó. Nút liên động cũng nhả khi mất focus, tạm dừng, đặt lại hoặc mở lại sơ đồ.

Nhóm **Điều khiển** có một **Công tắc xoay tùy chỉnh**: chọn **Số nấc** từ 2 đến 13 trong Thuộc tính, mỗi nấc có một vạch. Số nấc lẻ có vị trí giữa `0`; ví dụ 7 nấc là `−3, −2, −1, 0, +1, +2, +3`. Số nấc chẵn đánh số từ `0`. Đặt tên SA1 rồi thêm các tiếp điểm NO/NC/CO cùng tên; trong thuộc tính mỗi tiếp điểm chọn nấc tác động. Khi mô phỏng, bấm trực tiếp vạch nấc để chọn hoặc bấm thân núm để chuyển tuần tự. Phím trái/phải chuyển từng nấc và dừng ở hai đầu; Home về `0`. Giảm số nấc tự đưa các vị trí không còn tồn tại về nấc gần nhất, cùng một bước hoàn tác. Sơ đồ cũ, lưu/mở và sao chép cả nhóm vẫn giữ liên kết.

Nhóm **Đóng cắt & bảo vệ** có **Rơ-le bảo vệ đa chức năng**: một linh kiện cho 10 lựa chọn dòng cực đại/cực tiểu, áp cực đại/cực tiểu, mất pha, thứ tự pha, mất cân bằng pha, dòng rò/chạm đất, tần số cực đại/cực tiểu. Ký hiệu trên linh kiện đổi theo chức năng. Đấu nguồn nuôi A1–A2, thêm NO/NC/CO cùng tên và đặt thời gian tác động. Khi mô phỏng, bấm linh kiện để thử/xóa sự cố: tiếp điểm đổi sau thời gian trễ nếu nguồn nuôi khép kín; mất nguồn hoặc xóa sự cố thì nhả. Đây là phép thử trạng thái, chưa tự đo và so sánh dòng/áp/tần số với ngưỡng.

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
| Động cơ DC | Phần ứng `+/−` và cuộn kích từ rời `F1/F2` cùng tên. Hỗ trợ kiểm tra cách đấu kích từ độc lập, song song, nối tiếp, hỗn hợp, kể cả khi có điện trở khởi động hoặc biến trở kích từ. Hỗn hợp cần cả cuộn nối tiếp và cuộn song song đúng vai trò, đều có dòng. Có dòng phần ứng mà thiếu kích từ thì không quay; chiều quay của động cơ hỗn hợp tham chiếu cuộn song song, không phụ thuộc thứ tự thêm linh kiện. |
| Máy phát DC/AC | Cần đồng thời trục được một động cơ/diesel lai và cuộn kích từ cùng tên được cấp DC. Mất một điều kiện thì mất đầu ra. Chưa mô phỏng quá trình tự kích từ dư. |
| Cuộn hút và tiếp điểm rời | Cuộn `A1/A2` phải khép mạch. NO `13/14` đóng, NC `21/22` mở khi cuộn cùng tên có điện. CO nối chung `11` với NC `12` khi nghỉ, chuyển sang NO `14` khi tác động. Có thể dùng nhiều tiếp điểm cùng tên, đặt ở các vị trí độc lập. |
| Rơle thời gian | Chọn trễ đóng hoặc trễ nhả và thời gian trễ ở cuộn. Tiếp điểm thời gian NO/NC cùng tên theo thời gian trễ; tiếp điểm thường cùng tên theo cuộn ngay lập tức. |
| Rơle nhiệt 1 cực / 3 cực | Chọn một phần tử nhiệt `1–2` hoặc bộ ba phần tử nhiệt trên đường công suất. Nhấn để mô phỏng tác động: NO/NC/CO rời cùng tên đổi trạng thái. Nhấn lại để reset. Bản thân đường công suất không bị ngắt; tiếp điểm phụ dùng để ngắt mạch cuộn hút. |
| CB 1P/3P và nút nhấn | CB đóng/cắt một hoặc ba cực. Nút NO/NC trở về trạng thái nghỉ sau khi thả. |
| Cầu chì | Khi đang chạy, bấm để mô phỏng đứt cầu chì, bấm lại để thay. Dây chảy hiện đứt và nhánh điện bị ngắt; chưa tự đứt theo dòng định mức. |
| Động cơ bước và driver | Driver cần nguồn DC kín; động cơ cần đủ hai cuộn qua bốn đầu `A+/A−/B+/B−`. Tần số xung bằng 0 cho trạng thái giữ, không quay. |
| EMY / ЭМУ | Khối chức năng máy điện khuếch đại từ trường ngang: cần trục lai và nguồn DC khép kín qua cuộn điều khiển `F1/F2` để có đầu ra `+/−`. |
| Đèn và trục cơ khí | Đèn sáng khi có dòng qua mạch kín. Đường tím nét đứt biểu diễn trục cơ; không thể nối trục vào đầu điện. |
| Công tắc, selector, dừng khẩn và hành trình | Cơ cấu không có chân điện; thêm NO/NC/CO rời cùng tên ở Thuộc tính. Selector dùng một mô hình chỉnh 2–13 nấc; mỗi tiếp điểm chọn nấc tác động. Dừng khẩn giữ sau khi nhấn, nhấn lại để nhả. Hành trình tác động khi giữ chuột và nhả khi thả. |
| Rơ-le bảo vệ đa chức năng | Chọn chức năng trên cùng một linh kiện, nguồn nuôi A1/A2 phải khép mạch. Bấm để thử/xóa sự cố; NO/NC/CO cùng tên theo trạng thái tác động sau thời gian trễ. Chưa tự đo đại lượng điện hoặc phát hiện sự cố thực tế. |
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

**Ctrl+S / Lưu tệp** ghi vào tệp đang mở hoặc tệp đã chọn khi lưu trước đó. Sơ đồ mới chọn nơi lưu lần đầu; **Ctrl+Shift+S** lưu thành tệp khác. Trên bản Windows, hộp thoại mở/lưu là hộp thoại hệ thống. Chrome/Edge hỗ trợ chọn tệp có quyền ghi cũng dùng được cách lưu này; trình duyệt không hỗ trợ sẽ tải xuống JSON và không thể ghi đè trực tiếp tệp đã mở.

Công tắc **Tự lưu (AutoSave)** trên thanh công cụ tự ghi các thay đổi vào tệp sau một khoảng chờ ngắn. AutoSave mặc định tắt; mở sơ đồ hoặc tạo sơ đồ khác sẽ tắt lại để tránh tự ghi vào tệp vừa mở. Trình duyệt có thể hỏi quyền ghi khi bật công tắc. Bản nháp khôi phục trong `localStorage` vẫn được giữ độc lập với công tắc này. Tệp lưu cấu hình thiết bị, liên kết, thông số, cách đi dây/ống và mức nước ban đầu; không lưu thời gian mô phỏng hoặc lượng nước đã chuyển trong lần chạy.

Định dạng hiện tại là `version: 2`. Sơ đồ v2 cũ vẫn đọc được; các đầu `95/96` của rơle nhiệt và contactor liền khối được giữ để tương thích. Phiên bản 1 dùng đường dây gộp nên không tự chuyển đổi sang sơ đồ từng đầu cực; dữ liệu cũ dùng khóa lưu riêng. `localStorage` có thể mất khi xóa dữ liệu trình duyệt, vì vậy nên xuất tệp cho các sơ đồ cần giữ.

## Đo lường và cảm biến

Mở nhóm **Đo lường & cảm biến** trên thanh linh kiện. Có sáu kiểu đấu nối; chọn **Đại lượng đo** trong Thuộc tính để đổi chức năng mà không cần thay linh kiện. Số đo nằm trong ký hiệu; Thuộc tính hiển thị đơn vị và lý do khi chưa đo được.

| Phần tử | Cách dùng |
|---|---|
| Điện áp / tần số | Đấu `V+`, `V−` song song với hai điểm cần đo. Kênh đo có trở kháng vô hạn, không tạo đường về cho cuộn hút hoặc tải. Điện áp AC là RMS; nguồn ba pha dùng tham số điện áp dây. |
| Dòng điện | Mắc `1–2` nối tiếp nhánh cần đo, chiều dương từ 1 đến 2 với DC. Kênh dòng là dây dẫn lý tưởng; mắc trực tiếp ngang hai cực nguồn sẽ gây nối tắt. |
| Công suất / điện năng | `I1–I2` nối tiếp tải; `U1–U2` mắc song song tải. Chọn W, var, VA, cosφ hoặc kWh. Hai kênh cách ly nhau. Điện năng tích lũy theo thời gian mô phỏng; đặt lại mô phỏng để xóa bộ đếm. |
| Giám sát pha | Đấu `L1/L2/L3`, chọn kiểm tra hiện diện pha hoặc thứ tự pha. Đổi chỗ hai pha để kiểm tra chiều thứ tự. |
| Tốc độ / chiều quay | Nối đầu trục vào trục ra của động cơ hoặc diesel. Chiều quay lấy từ trạng thái trục; không dùng dấu ±1 của mô hình trạng thái làm số vòng/phút. |
| Cảm biến quá trình | Chọn nhiệt độ, áp suất, mức, lưu lượng, tiệm cận, vị trí, độ ẩm, độ rọi, độ rung hoặc mômen. Nhập giá trị giả lập, chọn ngưỡng ≥/≤ và độ trễ hồi phục. Đấu nguồn `A1/A2` và thêm NO/NC/CO cùng tên để thử mạch điều khiển. Mất nguồn thì ngõ ra nhả. |

**Phạm vi số đo:** U/f lấy từ nguồn và cách nối được hỗ trợ; I/P/Q/S/cosφ/kWh hiện tính cho mạch điện trở có đủ tham số. Chưa tính trở kháng cuộn hút, tải động cơ, RLC quá độ, sóng hài hay công suất cơ thực. Những trường hợp chưa đủ mô hình hiện **—**, không dùng giá trị nội bộ của bộ kiểm tra mạch kín làm số đo. Giá trị nhiệt độ, áp suất… là đầu vào do người dùng nhập để thử tiếp điểm, chưa tự sinh từ tải hoặc môi trường. Rơ-le bảo vệ đa chức năng hiện vẫn dùng thao tác thử sự cố, chưa tự nhận số đo từ cảm biến điện.

Hai mạch mẫu đi kèm: **Đo điện · U, I và công suất** (24 V, 12 Ω → 2 A, 48 W) và **Cảm biến mức · điều khiển tiếp điểm** (đóng ở 70%, nhả khi xuống dưới 65%).

## Thủy lực

Nhóm **Thủy lực** dùng đường ống xanh lam và đầu nối riêng. Vẽ, sửa góc, rẽ nhánh và đặt nút nối giống dây điện; ống, dây điện, trục và khóa cơ khí không nối lẫn nhau. Giao nhau không có nút nối vẫn độc lập. Chọn ống để đặt chiều dài và xem lưu lượng/áp suất.

| Phần tử | Cách dùng |
|---|---|
| Bơm dẫn động trục | Nối trục vào động cơ hoặc diesel; hút ở `IN`, đẩy ở `OUT`. Cấu hình lưu lượng tự do (L/min) và áp suất khóa đầu đẩy (bar). Chưa có trục quay hoặc không có nước hút thì không bơm được. |
| Bồn nước | Có một đầu vào và một đầu ra. Đặt dung tích, mức ban đầu và áp suất nguồn. Bơm hút làm giảm lượng nước, bơm vào làm tăng; lượng nước được giới hạn tại cạn/đầy. |
| Nguồn / nơi xả vô tận | Chọn chế độ vô tận của bồn để mô phỏng biển hoặc môi trường tiếp nhận. Không tiêu hao nguồn hay làm đầy nơi xả. Ký hiệu hiển thị ∞; cảm biến mức không trả phần trăm cho nguồn này. |
| Van tùy chỉnh | Chọn van khóa tay, một chiều, tiết lưu hoặc an toàn trong Thuộc tính. Bấm van khóa để đóng/mở. Van một chiều và an toàn cho dòng `IN → OUT`; van an toàn dùng ngưỡng chênh áp. |
| Van điện từ | Đường nước `IN–OUT` thường đóng, chỉ mở khi cuộn `A1–A2` được cấp điện khép kín. |
| Bộ lọc | Đặt hệ số tổn thất và độ tắc; tắc 100% chặn dòng. |
| Cảm biến áp suất | Nối đầu `P` vào ống, đọc áp suất tương đối theo bar. Có thể đặt ngưỡng âm ở phía hút. |
| Cảm biến lưu lượng | Mắc `IN–OUT` nối tiếp ống; đo độ lớn lưu lượng L/min. |
| Cảm biến mức | Chọn bồn cần đo trong Thuộc tính; lấy phần trăm nước hiện có trong bồn hữu hạn. |

Ba cảm biến thủy lực hoạt động như công tắc ngưỡng: chọn ≥ hoặc ≤, ngưỡng tác động và độ trễ hồi phục; thêm NO/NC/CO cùng tên để điều khiển mạch điện. Giá trị lấy từ mô hình nước, khác với đầu vào nhập tay của cảm biến quá trình. Sao chép cả bồn và cảm biến giữ liên kết với bồn mới; sao chép riêng cảm biến giữ bồn đang đo.

Hai mạch mẫu **Thủy lực · bơm chuyển nước giữa hai bồn** và **Thủy lực · bơm mồi và liên động áp suất** minh họa truyền nước, báo mức và điều khiển động cơ theo áp suất. Ở mạch bơm mồi, giữ S1 cho tới khi bơm chính chạy rồi thả; van một chiều cách ly bơm mồi đã dừng.

Mô hình nước dùng đường đặc tính bơm tuyến tính `Q = Q₀ × (1 − Δp/p₀)`, tổn thất ống tuyến tính cố định `0,001 bar/(L/min)/m` và cân bằng thể tích theo thời gian. Bơm quay ở bất kỳ tốc độ/dấu nào hiện dùng đặc tính đặt và chiều `IN → OUT`; bơm dừng chặn đường qua bơm. Bồn được coi là tiết diện đều, áp suất biên đặt cố định; chưa tính độ cao, cột áp theo mức, quán tính, nước va, xâm thực, không khí trong ống hoặc tải mômen lên động cơ. Đây là mô hình thử điều khiển, không phải bộ tính chọn bơm/ống thực tế. Các khái niệm bồn hữu hạn, nguồn vô tận và đường đặc tính bơm được tham khảo từ [tài liệu EPANET của US EPA](https://github.com/USEPA/EPANET2.2/blob/master/User_Manual/docs/3_network_model.rst); ứng dụng không sử dụng bộ giải EPANET.

## Khóa chéo cơ khí

**Tiếp điểm khóa chéo cơ khí** là tiếp điểm NO có thêm đầu `lock`. Nối hai đầu `lock` bằng đường nét đứt để tạo khóa chéo; cuộn hút hoặc cơ cấu điều khiển cùng tên vẫn phát lệnh đóng như tiếp điểm thường. Khi một tiếp điểm đang đóng, tiếp điểm được nối khóa với nó không thể đóng dù có lệnh. Nếu hai tiếp điểm nhận lệnh cùng lúc từ trạng thái mở, cả hai giữ mở; khi bên đang đóng nhả, bên còn nhận lệnh có thể đóng. Đường khóa không dẫn điện và không làm cuộn hút mất điện.

## Kiểm thử và mở rộng

```powershell
npm test
npm run test:files
npx playwright install chromium
npm run test:e2e
```

Kiểm thử mô hình bao gồm mạch kín/hở, nguồn độc lập, kích từ và lai cơ, sao/tam giác, tự giữ, rơle thời gian, rơle nhiệt và CO, trạng thái thao tác, đường dây và nhập/xuất. Kiểm thử trình duyệt thực hiện các thao tác vẽ và mô phỏng; ảnh/trace lỗi được ghi trong `test-results/`.

Các phần chính của mã nguồn:

| Tệp | Vai trò |
|---|---|
| `src/App.tsx` | Biên tập sơ đồ, thao tác, lưu tệp và điều phối mô phỏng |
| `src/components/EquipmentNode.tsx`, `SchematicSymbol.tsx`, `HydraulicSymbol.tsx` | Ký hiệu SVG, đầu cực, thao tác và nhãn phần tử |
| `src/components/useProjectFiles.ts`, `desktop/document-files.cjs` | Ctrl+S, AutoSave, chọn tệp và ghi tệp desktop |
| `src/components/SchematicEdge.tsx` | Dây vuông góc, sửa đường đi, hiển thị dòng |
| `src/components/CircuitMonitor.tsx` | Trạng thái mạch và nhật ký tùy chọn |
| `src/model/catalog.ts`, `types.ts` | Loại phần tử, đầu cực, tham số và thao tác cho phép |
| `src/model/simulation.ts` | Kiểm tra kết nối và logic hoạt động |
| `src/model/hydraulics.ts`, `hydraulicCatalog.ts` | Mạng ống, bơm, bồn và cảm biến thủy lực |
| `src/model/interlocks.ts` | Khóa chéo cơ khí giữa các tiếp điểm |
| `src/model/measurements.ts`, `sensors.ts` | Đo điện độc lập với logic đóng/cắt, chức năng cảm biến và so sánh ngưỡng |
| `src/model/geometry.ts` | Tọa độ đầu cực, góc xoay và định tuyến |
| `src/model/persistence.ts`, `examples.ts` | Định dạng JSON v2 và các mạch mẫu |
| `src/schematic.css` | Giao diện bản vẽ và các bảng công cụ |

Để thêm thiết bị, bổ sung `DeviceKind`, định nghĩa đầu cực trong `catalog.ts`, ký hiệu SVG, hành vi trong `simulation.ts` và kiểm thử điều kiện hoạt động. Các kiểu dữ liệu và bộ giải độc lập với giao diện để có thể bổ sung phần tính toán sau.

# Iwolf – IELTS Werewolf RPG

## Main Hub

`index.html` dùng ảnh Main Hub mới. `assets/` chứa nền, bài vai và ảnh UI tham khảo.

## Chạy bản local

Mở `index.html` rồi chọn **Chơi thử một thiết bị** để dùng bản local có vòng game và luật trong đặc tả.

## Bật multiplayer qua Supabase

Multiplayer dùng Supabase Auth (anonymous), Postgres và Realtime. Tất cả thiết bị phải mở cùng một URL ứng dụng đã host và trỏ tới cùng một Supabase project.

1. Tạo Supabase project và bật **Email** trong phần Auth. Game đăng nhập bằng link email; Anonymous Sign-Ins vẫn tắt.
2. Chạy toàn bộ `supabase/schema.sql` trong SQL Editor (có thể chạy lại để thêm cấu hình mới).
3. Sao chép Project URL và publishable key (tiền tố `sb_publishable_`) vào `supabase/config.js`. Không đặt service role/secret key trong trình duyệt.
4. Thêm URL callback của ứng dụng vào Auth → URL Configuration (localhost trong dev và domain HTTPS khi triển khai), rồi host ứng dụng tại HTTPS. Mỗi thiết bị nhập email, mở link xác thực trên cùng thiết bị, rồi tạo/vào phòng. `file://` không hỗ trợ đăng nhập multiplayer. `localhost` chỉ dành cho dev trên cùng máy.
5. Host chọn số người và mức Speaking tối thiểu từ 3.0 đến 8.0; người khác nhập mã phòng. Vai riêng chỉ được trả về cho tài khoản người chơi tương ứng.

Schema khóa quyền đọc trực tiếp bảng vai trò, dùng RPC có kiểm tra thành viên/quản trò, và cho phép realtime chỉ trên bảng phòng/danh sách người chơi công khai.

## Bốn API nhận câu trả lời Speaking

`supabase/schema.sql` tạo bảng `iwolf_speaking_answers` (câu trả lời gốc bị khóa khỏi quyền đọc trực tiếp) cùng bốn RPC được gọi qua Supabase PostgREST:

| RPC | Nhóm ghế |
| --- | --- |
| `iwolf_submit_answer_group_1` | 1–3 |
| `iwolf_submit_answer_group_2` | 4–6 |
| `iwolf_submit_answer_group_3` | 7–9 |
| `iwolf_submit_answer_group_4` | 10–12 |

Mỗi tài khoản chỉ được gọi API của nhóm mà ghế của họ thuộc về, chỉ gửi trong pha đêm và chỉ thay câu trả lời của chính mình. Cả bốn API lưu câu trả lời, đếm từ và trả về snapshot phòng chứa `speaking_report` dùng chung. Báo cáo công khai tên, nhóm API, trạng thái gửi, số từ và điểm; không trả nguyên văn câu trả lời. Test Game Function tự báo 7.0 cho cả phòng mà không cần gửi đáp án.

Điểm thật để trống (`null`) cho đến khi có dịch vụ AI hoặc người chấm đáng tin cậy; các API này hiện nhận/lưu/đếm câu trả lời và tổng hợp tiến độ, chưa chấm IELTS. Đăng nhập bằng email magic link; Anonymous Sign-Ins được giữ tắt. Chạy `supabase/schema.sql` trong SQL Editor để cài bảng cùng RPC.

## Test Game Function

Bật công tắc **Test Game Function** trước khi tạo phòng, rồi nhập mật mã đã cấp. Phòng vẫn được tạo và chơi theo luồng bình thường; tất cả người chơi tự động đạt 7.0 và không phải trả lời Speaking. Khách tham gia một phòng có test mode được áp dụng cấu hình của phòng. RPC tạo phòng kiểm tra lại mật mã.

Nút **Mở 6 màn hình riêng · Player A–F** mở sáu tab mô phỏng, mỗi tab có vai trò và giao diện riêng. Chat và pha chơi đồng bộ giữa các tab qua `localStorage` trên cùng trình duyệt. Đây là công cụ xem UI; không tạo phiên đăng nhập, không ghi dữ liệu Supabase và không kiểm tra kết nối giữa sáu thiết bị thật.

## Phạm vi hiện tại

Có tạo/vào phòng, danh sách tự cập nhật, phân vai riêng, pha chung do host điều khiển, gửi Speaking, mục tiêu đêm, phiếu ban ngày và chat. Giao diện đêm dùng `Đêm BG.jpeg` cùng các khung theo vai; Tiên Tri và phe Sói dùng ảnh View tương ứng, các vai khác có lời nhắc và lựa chọn hành động riêng. Mức Speaking tối thiểu được lưu theo phòng; chế độ thường chưa tự chấm/kiểm ngưỡng vì AI Speaking chưa kết nối. Phân xử tự động toàn bộ luật (bảo hộ, cắn, cứu, treo cổ, khả năng đặc biệt và thắng/thua) chưa đồng bộ hết lên backend. Cấu hình kết nối nằm trong `supabase/config.js` và dùng publishable key.

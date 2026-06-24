curl -k -X POST "https://wcfapi.sso.go.th/auth/user/token?grant_type=password&username=loadtest.g4&password=Password123" \
    --resolve "wcf.sso.go.th:443:172.20.13.33" \
    --resolve "wcfapi.sso.go.th:443:172.20.13.33" \
    --noproxy "*" \
    -H "accept-encoding: gzip, deflate, br" \
    -H "accept: */*" \
    -H "authorization: Basic bG9hZC10ZXN0OkJHRjgwamdyWGE=" \
    -H "cookie: JSESSIONID=16300A7BD61D18DA1E732FAB994787BF" \
    -H "user-agent: httpyac"

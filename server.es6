import apn from 'apn'
import express from 'express'
import bodyParser from 'body-parser'
import fetch from 'isomorphic-fetch'
import pg from 'pg'

let app = express()
let gcmUrl = 'https://gcm-http.googleapis.com/gcm/send'
let gcmKey = 'AIzaSyD6GYalxuGLWy-oMvw3HixS_9ecs_RNFNI'
let apnOptions = {
  // both the key and the cerficate are in the .pem file so we can use the same file for both key and certificate
  key: "conf/cert.pem",
  cert: "conf/cert.pem",
}
let apnConnection


app.use(bodyParser.json())
app.use(bodyParser.urlencoded({
  extended: true
}))


app.get('/', function(req, res){
  res.send('Hello World!')
})


app.get('/db', function(req, res){
  pg.connect(process.env.DATABASE_URL, function(err, client, done){
    if(!client){
      done()
      res.send(err)
      return
    }
    client.query('SELECT * FROM tokens', function(err, result){
      done()
      if(err){
        console.error(err)
        res.send("Error " + err)
      }
      else{
        res.send({results: result.rows})
      }
    })
  })
})


app.post('/token', function(req, res){
  let os = req.body.os
  let token = req.body.token
  Object.keys(req.body).forEach(function(key){
    console.log(key, ':', req.body[key])
  })

  pg.connect(process.env.DATABASE_URL, function(err, client, done){
    if(!client){
      done()
      res.send(err)
      return
    }
    // check if this token has already been stored, if not -> store it
    client.query(`SELECT id FROM tokens WHERE token='${token}';`, function(err, result){
      if(err){
        console.error(err)
      }
      else{
        if(result.rowCount === 0){
          client.query(`INSERT INTO tokens (token, os) VALUES ('${token}', '${os}')`, function(err, result){
            if(err){
              console.error(err)
              res.send("Error " + err)
            }
            else{
              res.send({results: result})
            }
          })
        }else{
          console.log(`token already stored in database: ${token}`)
        }
      }
    })
    done()
  })
})


// push message to device
app.post('/commit', function(req, res) {

  let data = req.body
  let message = `new commit from ${data.sender.login} to repository ${data.repository.full_name} at ${new Date(data.repository.pushed_at).toString()}`
  console.log(message)

  let promises = []
  let tokens = []
  let numReceivers = 0
  let numErrors = 0


  pg.connect(process.env.DATABASE_URL, function(err, client, done){
    if(!client){
      done()
      res.send(err)
      return
    }
    client.query('SELECT * FROM tokens', function(err, result){

      if(err){
        console.error(err)
        res.send('Error ' + err)
      }
      else{
        result.rows.forEach(function(row){
          numReceivers++
          let token = row.token
          tokens.push(token)
          console.log(row.os)
          if(row.os === 'android'){
            promises.push(sendToGCM(token, message))
          }else if(row.os === 'ios'){
            // promises.push(sendToAPN(token, message))
            sendToAPN(token, message)
          }
        })

        Promise.all(promises).then(
          (responses) => {
            //console.log('responses', responses)
            responses.forEach((response, i) => {
              if(response.ok){
                console.log(response.statusText)
              }else{
                // remove the invalid tokens
                console.log(`error with token ${tokens[i]}: ${response.statusText}`)
                numReceivers--
                numErrors++
                client.query(`DELETE FROM tokens WHERE token='${tokens[i]}';`, function(err, result){
                  console.log(err)
                  console.log(result)
                })
              }
            })
            res.send({numReceivers, numErrors})
          }
        )
      }
    })

    done()
  })
})


function sendToGCM(token, message){
  return fetch(gcmUrl,{
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `key=${gcmKey}`
    },
    body: JSON.stringify({
      to: token,
      data: {
        message
      }
    })
  })
}


function sendToAPN(token, message){
  let device = new apn.Device(token)
  let notification = new apn.Notification()
  notification.expiry = Math.floor(Date.now() / 1000) + 3600
  notification.payload = {message}
  notification.badge = 1
  notification.sound = "dong.aiff"
  notification.alert = message
  apnConnection.pushNotification(notification, device)
  //console.log(notification, device)
}

// push notification to topic
app.post("/commit2", function(req, res) {

  let data = req.body
  let message = `new commit from ${data.sender.login} to repository ${data.repository.full_name} at ${data.repository.pushed_at}`
  let payload = {
    to: '/topics/global',
    data: {
      message
    }
  }

  fetch(gcmUrl, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `key=${gcmKey}`
    },
    body: JSON.stringify(payload)
  })
  .then(
    (response) => {
      console.log(response.ok, response.statusText)
      //response = checkStatus(response)
    },
    (error) => {
      console.log(error)
    }
  )
  .then((response) => {
    return response.json()
  })
  .then((data) => {
    console.log(data)
  })

  res.send({status: 'SUCCESS'})
})


let port = process.env.PORT || 5000;
app.listen(port)
console.log(`server listening at port ${port}`)

// open APN connection
apnConnection = new apn.Connection(apnOptions)
//console.log(apnConnection)


process.on('exit', function (){
  apnConnection = null
  console.log('Goodbye!')
})


/*
function checkStatus(response) {
  //console.log(response)
  if(response.status >= 200 && response.status < 300) {
    return response
  }else{
    let error = new Error(response.statusText)
    error.response = response
    throw error
  }
}
*/
